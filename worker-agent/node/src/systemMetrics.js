
import os from "os";
import process from "process";



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
 * Build the JSON response for GET /health.
 *
 * This should return dynamic information that can change over time:
 * - uptime
 * - load average
 * - how many jobs are running
 * - max concurrent jobs
 * - temperature (if available; null in v1)
 */
export function buildHealth({ runningJobs, maxConcurrentJobs }) {
  const load = os.loadavg(); // [1min, 5min, 15min]

  return {
    status: "ok", // v1: always "ok" unless we add smarter checks
    uptime_seconds: Math.round(process.uptime()),
    load_average: load,
    running_jobs: runningJobs,
    max_concurrent_jobs: maxConcurrentJobs,
    temperature_c: null // placeholder; we can wire real sensors later
  };
}
