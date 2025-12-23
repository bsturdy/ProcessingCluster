/*
  ProcessorCluster Dashboard
  - User enters IP range
  - Click Start to begin non-blocking discovery + polling
  - Polling only hits known workers
*/

let discoveryTimer = null;
let pollTimer = null;
let activeRunToken = 0;



const knownWorkerIPs = new Set();
const workerState = new Map(); // ip -> { missCount: number }
const KNOWN_WORKERS_KEY = "pcdash.knownWorkerIPs";


async function bootstrapKnownWorkersOnce(timeoutMs) {
  const ips = Array.from(knownWorkerIPs);
  if (ips.length === 0) return;

  const results = await Promise.all(ips.map(ip => fetchWorkerData(ip, timeoutMs)));

  for (const r of results) {
    if (r.error) {
      updateWorkerCard(r.ip, { ip: r.ip, error: true });
    } else {
      updateWorkerCard(r.ip, r);
    }
  }
}


function loadKnownWorkerIPs() {
  try {
    const raw = localStorage.getItem(KNOWN_WORKERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => typeof x === "string");
  } catch {
    return [];
  }
}



function saveKnownWorkerIPs() {
  localStorage.setItem(KNOWN_WORKERS_KEY, JSON.stringify(Array.from(knownWorkerIPs)));
}



function noteWorkerOk(ip) {
  workerState.set(ip, { missCount: 0 });
}


function noteWorkerMiss(ip) {
  const s = workerState.get(ip) ?? { missCount: 0 };
  s.missCount += 1;
  workerState.set(ip, s);
  return s.missCount;
}


function setUiStatus(text) {
  const el = document.getElementById("uiStatus");
  if (el) el.textContent = text;
}

function readInt(id, fallback) {
  const el = document.getElementById(id);
  const v = Number.parseInt(el?.value ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

function readStr(id, fallback) {
  const el = document.getElementById(id);
  const v = (el?.value ?? "").trim();
  return v.length ? v : fallback;
}

function saveSettings(s) {
  localStorage.setItem("pcdash.settings", JSON.stringify(s));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("pcdash.settings");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applySettingsToUi(s) {
  document.getElementById("ipPrefix").value = s.ipPrefix ?? "192.168.1.";
  document.getElementById("ipStart").value = s.ipStart ?? 1;
  document.getElementById("ipEnd").value = s.ipEnd ?? 254;
  document.getElementById("probeTimeout").value = s.probeTimeoutMs ?? 1000;
  document.getElementById("discoveryInterval").value = s.discoveryIntervalMs ?? 10000;
  document.getElementById("pollInterval").value = s.pollIntervalMs ?? 500;
  document.getElementById("missedThreshold").value = s.missedThreshold ?? 3;
}

function validateSettings(s) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(s.ipPrefix)) {
    return `IP Prefix must look like "192.168.1."`;
  }
  if (s.ipStart < 0 || s.ipStart > 255 || s.ipEnd < 0 || s.ipEnd > 255) {
    return "Start/End must be within 0..255";
  }
  if (s.ipStart > s.ipEnd) {
    return "Start must be <= End";
  }
  if (s.probeTimeoutMs < 50) return "Probe timeout too small (min 50ms)";
  if (s.discoveryIntervalMs < 200) return "Discovery interval too small (min 200ms)";
  if (s.pollIntervalMs < 100) return "Poll interval too small (min 100ms)";
  return null;
}

/*
  Fetches and processes data from a worker node given its IP address.
*/
async function fetchWorkerData(ipAddress, timeoutMs = 1000) {
  try {
    const base = `http://${ipAddress}:9000`;

    const [info, health] = await Promise.all([
      fetchJsonWithTimeout(`${base}/info`, timeoutMs),
      fetchJsonWithTimeout(`${base}/health`, timeoutMs)
    ]);

    return {
      ip: ipAddress,
      workerId: info.worker_id,
      hostname: info.hostname,
      protocolVersion: info.protocol_version,
      cpuCores: info.cpu_cores,
      cpuThreads: info.cpu_threads,
      memoryMB: info.memory_mb,
      labels: info.labels,

      status: health.status,
      uptimeSeconds: health.uptime_seconds,
      loadAverage: health.load_average,
      runningJobs: health.running_jobs,
      maxConcurrentJobs: health.max_concurrent_jobs,
      temperatureC: health.temperature_c
    };
  } catch (err) {
    return { ip: ipAddress, error: true, message: err?.message ?? "unreachable" };
  }
}


/*
  Get JSON data with a timeout
*/
async function fetchJsonWithTimeout(url, timeoutMs = 1000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

/*
  Probe a worker device once, returning its data or null if unreachable
*/
async function probeWorkerOnce(ipAddress, timeoutMs = 1000) {
  try {
    const base = `http://${ipAddress}:9000`;
    const info = await fetchJsonWithTimeout(`${base}/info`, timeoutMs);
    const health = await fetchJsonWithTimeout(`${base}/health`, timeoutMs);

    return {
      ip: ipAddress,
      workerId: info.worker_id,
      hostname: info.hostname,
      protocolVersion: info.protocol_version,
      cpuCores: info.cpu_cores,
      cpuThreads: info.cpu_threads,
      memoryMB: info.memory_mb,
      labels: info.labels,

      status: health.status,
      uptimeSeconds: health.uptime_seconds,
      loadAverage: health.load_average,
      runningJobs: health.running_jobs,
      maxConcurrentJobs: health.max_concurrent_jobs,
      temperatureC: health.temperature_c
    };
  } catch {
    return null;
  }
}

/*
  Create an array of IP addresses from a given prefix
*/
function generateIpRange(prefix, start = 1, end = 254) {
  const ips = [];
  for (let i = start; i <= end; i++) {
    ips.push(`${prefix}${i}`);
  }
  return ips;
}

/*
  Kick off discovery process, calling onWorkerFound for each active worker found.
  Non-blocking: does not await dead IPs.
*/
function kickOffDiscovery(ipList, timeoutMs, onWorkerFound, runToken) {
  ipList.forEach(ip => {
    (async () => {
      const data = await probeWorkerOnce(ip, timeoutMs);

      // Stop/Restart protection: ignore stale results
      if (runToken !== activeRunToken) return;

      if (data) {
        onWorkerFound(ip, data);
      }
    })();
  });
}

/*
  Format uptime seconds into "Xd Xh Xm Xs"
*/
function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";

  const d = Math.floor(seconds / 86400);
  seconds %= 86400;
  const h = Math.floor(seconds / 3600);
  seconds %= 3600;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!parts.length || s) parts.push(`${s}s`);
  return parts.join(" ");
}

/*
  Format load average array [1,5,15] into string
*/
function formatLoad(loadAvg) {
  if (!Array.isArray(loadAvg) || loadAvg.length < 3) return "unknown";
  return `${loadAvg[0].toFixed(2)} / ${loadAvg[1].toFixed(2)} / ${loadAvg[2].toFixed(2)}`;
}

/*
  Update worker front-end block with values
*/
function updateWorkerCard(ip, data) {
  const safeId = `worker-${ip.replaceAll(".", "-")}`;
  const card = document.getElementById(safeId);
  if (!card) return;

  const isOffline = !!data.error;
  card.classList.toggle("offline", isOffline);

  if (data.error) {
    card.querySelector(".worker-status").textContent = "Offline";
    card.querySelector(".worker-name").textContent = ip;
    card.querySelector(".worker-uptime").textContent = "—";
    card.querySelector(".worker-load").textContent = "—";
    card.querySelector(".worker-temp").textContent = "—";
    card.querySelector(".worker-labels").textContent = "—";
    card.querySelector(".worker-running").textContent = "—";
    card.querySelector(".worker-max").textContent = "—";
    card.classList.add("offline");
    return;
  }

  card.classList.remove("offline");

  card.querySelector(".worker-name").textContent = data.workerId;
  card.querySelector(".worker-hostname").textContent = data.hostname;
  card.querySelector(".worker-protocol").textContent = data.protocolVersion;

  card.querySelector(".worker-cpu").textContent = `${data.cpuCores} cores / ${data.cpuThreads} threads`;
  card.querySelector(".worker-ram").textContent = `${data.memoryMB} MB`;

  card.querySelector(".worker-status").textContent = data.status;
  card.querySelector(".worker-running").textContent = data.runningJobs;
  card.querySelector(".worker-max").textContent = data.maxConcurrentJobs;

  card.querySelector(".worker-uptime").textContent = formatUptime(data.uptimeSeconds);
  card.querySelector(".worker-load").textContent = formatLoad(data.loadAverage);

  const tempVal = (data.temperatureC === null || data.temperatureC === undefined)
    ? "N/A"
    : `${data.temperatureC} °C`;
  card.querySelector(".worker-temp").textContent = tempVal;

  const labelsText = Array.isArray(data.labels) && data.labels.length
    ? data.labels.join(", ")
    : "none";
  card.querySelector(".worker-labels").textContent = labelsText;
}

/*
  Ensure UI card exists
*/
function ensureWorkerCard(ip) {
  const safeId = `worker-${ip.replaceAll(".", "-")}`;
  if (document.getElementById(safeId)) return;

  const container = document.getElementById("workers-container");

  const div = document.createElement("div");
  div.className = "worker-card";
  div.id = safeId;

  div.innerHTML = `
    <h3>Worker: <span class="worker-name">${ip}</span></h3>

    <div class="info-line">Hostname: <span class="worker-hostname">loading...</span></div>
    <div class="info-line">Protocol Version: <span class="worker-protocol">loading...</span></div>

    <div class="info-line">CPU: <span class="worker-cpu">loading...</span></div>
    <div class="info-line">RAM: <span class="worker-ram">loading...</span></div>

    <div class="info-line">Status: <span class="worker-status">loading...</span></div>
    <div class="info-line">Running Jobs: <span class="worker-running">loading...</span></div>
    <div class="info-line">Max Concurrent Jobs: <span class="worker-max">loading...</span></div>

    <div class="info-line">Uptime: <span class="worker-uptime">loading...</span></div>
    <div class="info-line">Load Avg (1/5/15): <span class="worker-load">loading...</span></div>

    <div class="info-line">Temperature: <span class="worker-temp">loading...</span></div>
    <div class="info-line">Labels: <span class="worker-labels">loading...</span></div>
  `;

  container.appendChild(div);
}

/*
  Poll only known workers
*/
function startDynamicWorkerPolling(intervalMs, timeoutMs, missedThreshold, runToken) {
  async function poll() {
    if (runToken !== activeRunToken) return;

    const ips = Array.from(knownWorkerIPs);
    if (ips.length === 0) return;

    // poll concurrently with hard per-request timeouts
    const results = await Promise.all(
      ips.map(ip => fetchWorkerData(ip, timeoutMs))
    );

    if (runToken !== activeRunToken) return;

    for (const r of results) {
      if (r.error) {
        const misses = noteWorkerMiss(r.ip);
        if (misses >= missedThreshold) {
          updateWorkerCard(r.ip, { ip: r.ip, error: true });
        }
      } else {
        noteWorkerOk(r.ip);
        updateWorkerCard(r.ip, r);
      }
    }
  }

  poll();
  return setInterval(poll, intervalMs);
}

function clearWorkersUi() {
  knownWorkerIPs.clear();
  const container = document.getElementById("workers-container");
  container.innerHTML = "";
}

/*
  Start/Stop control plane
*/
function startDashboard() {
  // Stop any existing run first
  stopDashboard();

  const settings = {
    ipPrefix: readStr("ipPrefix", "192.168.1."),
    ipStart: readInt("ipStart", 1),
    ipEnd: readInt("ipEnd", 254),
    probeTimeoutMs: readInt("probeTimeout", 1000),
    discoveryIntervalMs: readInt("discoveryInterval", 10000),
    pollIntervalMs: readInt("pollInterval", 500),
    missedThreshold: readInt("missedThreshold", 3)
  };

  const err = validateSettings(settings);
  if (err) {
    setUiStatus(`Error: ${err}`);
    return;
  }

  saveSettings(settings);

  const ipCandidates = generateIpRange(settings.ipPrefix, settings.ipStart, settings.ipEnd);

  activeRunToken++;
  const runToken = activeRunToken;

  setUiStatus(`Running (scanning ${settings.ipPrefix}${settings.ipStart}..${settings.ipEnd})`);

  const discoveryTick = () => {
    kickOffDiscovery(ipCandidates, settings.probeTimeoutMs, (ip, data) => {
      if (!knownWorkerIPs.has(ip)) {
        knownWorkerIPs.add(ip);
        saveKnownWorkerIPs();
        ensureWorkerCard(ip);
      }
      updateWorkerCard(ip, data);
    }, runToken);
  };

  // Run immediately, then periodically
  discoveryTick();
  discoveryTimer = setInterval(discoveryTick, settings.discoveryIntervalMs);

  pollTimer = startDynamicWorkerPolling(
  settings.pollIntervalMs,
  settings.probeTimeoutMs,
  settings.missedThreshold,
  runToken
);

}

function stopDashboard() {
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (pollTimer) clearInterval(pollTimer);
  discoveryTimer = null;
  pollTimer = null;

  activeRunToken++; // invalidate in-flight async callbacks
  setUiStatus("Idle");
}

/*
  Wire UI
*/
document.addEventListener("DOMContentLoaded", () => {
  const saved = loadSettings();
  applySettingsToUi(saved ?? {
    ipPrefix: "192.168.1.",
    ipStart: 1,
    ipEnd: 254,
    probeTimeoutMs: 1000,
    discoveryIntervalMs: 10000,
    pollIntervalMs: 500
  });

  // restore known workers from localStorage
  for (const ip of loadKnownWorkerIPs()) {
    if (!knownWorkerIPs.has(ip)) {
      knownWorkerIPs.add(ip);
      ensureWorkerCard(ip);
    }
  }

  const bootstrapTimeout = (saved?.probeTimeoutMs ?? 1000);
  bootstrapKnownWorkersOnce(bootstrapTimeout);


  document.getElementById("startBtn").addEventListener("click", startDashboard);
  document.getElementById("stopBtn").addEventListener("click", stopDashboard);
  document.getElementById("clearBtn").addEventListener("click", () => {
    clearWorkersUi();
    saveKnownWorkerIPs(); // persist the cleared state
    setUiStatus("Idle (cleared)");
  });

  startDashboard();
});
