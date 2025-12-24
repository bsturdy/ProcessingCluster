
import os from "os";
import process from "process";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";



/**
 * Resolve paths relative to this module (not process.cwd()) so systemd/pm2 CWD changes
 * don't break anything.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



/**
 * Best-effort OS string.
 * - Cross-platform baseline: "<platform> <release>"
 * - Linux enhancement: PRETTY_NAME from /etc/os-release (if present)
 */
function detectOsString() {
  const platform = os.platform();
  const release = os.release();

  if (platform === "linux") {
    try {
      const text = fs.readFileSync("/etc/os-release", "utf8");
      const match = text.match(/^PRETTY_NAME\s*=\s*"?(.+?)"?\s*$/m);
      if (match && match[1]) return `${match[1]} (linux ${release})`;
    } catch {
      // ignore
    }
    return `linux ${release}`;
  }

  if (platform === "darwin") return `darwin ${release}`;
  if (platform === "win32") return `windows ${release}`;

  return `${platform} ${release}`;
}



/**
 * Best-effort physical core count.
 * Returns number or null.
 */
function detectPhysicalCores() {
  const platform = os.platform();

  // Linux: count unique (physical id, core id) pairs from /proc/cpuinfo
  if (platform === "linux") {
    try {
      const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
      const blocks = cpuinfo.split("\n\n").filter(Boolean);

      const coreKeys = new Set();
      let sawTopology = false;

      for (const block of blocks) {
        let physicalId = null;
        let coreId = null;

        for (const line of block.split("\n")) {
          const i = line.indexOf(":");
          if (i === -1) continue;
          const key = line.slice(0, i).trim();
          const val = line.slice(i + 1).trim();

          if (key === "physical id") physicalId = val;
          if (key === "core id") coreId = val;
        }

        if (physicalId !== null && coreId !== null) {
          sawTopology = true;
          coreKeys.add(`${physicalId}:${coreId}`);
        }
      }

      if (sawTopology && coreKeys.size > 0) return coreKeys.size;
    } catch {
      // ignore
    }

    // Linux fallback: lscpu if available
    try {
      const out = execSync("lscpu -p=CORE", { encoding: "utf8" });
      const coreIds = new Set();
      for (const line of out.split("\n")) {
        if (!line || line.startsWith("#")) continue;
        coreIds.add(line.trim());
      }
      if (coreIds.size > 0) return coreIds.size;
    } catch {
      // ignore
    }

    return null;
  }

  // macOS: sysctl
  if (platform === "darwin") {
    try {
      const out = execSync("sysctl -n hw.physicalcpu", { encoding: "utf8" }).trim();
      const n = Number(out);
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      // ignore
    }
    return null;
  }

  // Windows: PowerShell CIM query (best-effort)
  if (platform === "win32") {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum"',
        { encoding: "utf8" }
      ).trim();
      const n = Number(out);
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      // ignore
    }
    return null;
  }

  return null;
}



/**
 * Build the JSON response for GET /info.
 */
export function buildInfo(config) {
  const cpus = os.cpus() || [];
  const threads = cpus.length;

  const cpuModel = cpus.length > 0 ? (cpus[0].model || null) : null;
  const cores = detectPhysicalCores(); // may be null by contract

  return {
    worker_id: config.workerId,
    hostname: os.hostname(),
    os: detectOsString(),
    os_architecture: os.arch(),
    protocol_version: 1,
    cpu_model: cpuModel,
    cpu_cores: cores,
    cpu_threads: threads,
    memory_mb: Math.round(os.totalmem() / (1024 * 1024)),
    labels: config.labels || []
  };
}



/**
 * Linux: read MemAvailable from /proc/meminfo (best signal for "how much can we allocate").
 * Fallback to os.freemem() on non-Linux or if parsing fails.
 */
function getMemoryAvailableMb() {
  const platform = os.platform();

  // Non-Linux fallback
  if (platform !== "linux") {
    return Math.round(os.freemem() / (1024 * 1024));
  }

  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");

    // Prefer MemAvailable
    const mAvail = txt.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (mAvail && mAvail[1]) {
      const kb = Number(mAvail[1]);
      if (Number.isFinite(kb) && kb >= 0) return Math.round(kb / 1024);
    }

    // Fallback approximation: MemFree + Buffers + Cached
    const mFree = txt.match(/^MemFree:\s+(\d+)\s+kB/m);
    const mBuf = txt.match(/^Buffers:\s+(\d+)\s+kB/m);
    const mCache = txt.match(/^Cached:\s+(\d+)\s+kB/m);

    const kb =
      (mFree ? Number(mFree[1]) : 0) +
      (mBuf ? Number(mBuf[1]) : 0) +
      (mCache ? Number(mCache[1]) : 0);

    if (Number.isFinite(kb) && kb >= 0) return Math.round(kb / 1024);
  } catch {
    // ignore
  }

  return Math.round(os.freemem() / (1024 * 1024));
}



/**
 * Node >=18: fs.statfsSync exists on Linux.
 * Returns { totalMb, availableMb } or null if unsupported.
 */
function statFsMb(targetPath) {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    const s = fs.statfsSync(targetPath);
    // f_frsize is preferred; fall back to bsize if needed
    const blockSize = Number(s.f_frsize || s.bsize);
    const totalBytes = Number(s.blocks) * blockSize;
    const availBytes = Number(s.bavail) * blockSize;

    if (!Number.isFinite(totalBytes) || !Number.isFinite(availBytes)) return null;

    return {
      totalMb: Math.round(totalBytes / (1024 * 1024)),
      availableMb: Math.round(availBytes / (1024 * 1024))
    };
  } catch {
    return null;
  }
}



/**
 * Resolve the absolute jobs path.
 * - Prefer env override (works with systemd)
 * - Otherwise default to "<this module dir>/jobs" which matches your repo layout
 */
function resolveJobsPath() {
  const envPath = process.env.WORKER_JOBS_DIR;
  if (envPath && typeof envPath === "string") return path.resolve(envPath);
  return path.resolve(__dirname, "jobs");
}



/**
 * Build the JSON response for GET /health.
 *
 * v2 additions:
 * - health_protocol_version + timestamp_unix_ms
 * - cpu_threads
 * - dedicated reservation state (empty for now; filled later by reservation manager)
 * - memory_total_mb + memory_available_mb
 * - jobs_path + disk stats
 * - docker_root_dir + disk stats
 *
 * Keeps all v1 fields unchanged for backwards compatibility with dashboards.
 */
export function buildHealth({
  runningJobs,
  maxConcurrentJobs,
  dedicatedReservedCpuIds = []
} = {}) {
  const load = os.loadavg(); // [1min, 5min, 15min]
  const cpuThreads = (os.cpus() || []).length;

  const memoryTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  const memoryAvailableMb = getMemoryAvailableMb();

  const jobsPath = resolveJobsPath();

  // Allow override if you ever move Docker root; default matches your current workers.
  const dockerRootDir = process.env.DOCKER_ROOT_DIR
    ? path.resolve(process.env.DOCKER_ROOT_DIR)
    : "/var/lib/docker";

  const jobsDisk = statFsMb(jobsPath) || statFsMb(path.dirname(jobsPath));
  const dockerDisk = statFsMb(dockerRootDir) || statFsMb(path.dirname(dockerRootDir));

  return {
    // v2 meta
    health_protocol_version: 2,
    timestamp_unix_ms: Date.now(),

    // v1 fields (unchanged)
    status: "ok",
    uptime_seconds: Math.round(process.uptime()),
    load_average: load,
    running_jobs: runningJobs,
    max_concurrent_jobs: maxConcurrentJobs,
    temperature_c: null,

    // v2 resource fields
    cpu_threads: cpuThreads,
    dedicated_reserved_cpu_ids: Array.isArray(dedicatedReservedCpuIds) ? dedicatedReservedCpuIds : [],
    dedicated_reserved_count: Array.isArray(dedicatedReservedCpuIds) ? dedicatedReservedCpuIds.length : 0,

    memory_total_mb: memoryTotalMb,
    memory_available_mb: memoryAvailableMb,

    jobs_path: jobsPath,
    jobs_disk_total_mb: jobsDisk ? jobsDisk.totalMb : null,
    jobs_disk_available_mb: jobsDisk ? jobsDisk.availableMb : null,

    docker_root_dir: dockerRootDir,
    docker_disk_total_mb: dockerDisk ? dockerDisk.totalMb : null,
    docker_disk_available_mb: dockerDisk ? dockerDisk.availableMb : null
  };
}
