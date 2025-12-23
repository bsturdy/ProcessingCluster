let discoveryTimer = null;
let pollTimer = null;
let activeRunToken = 0;

const knownWorkerIPs = new Set();
const workerState = new Map(); // ip -> { missCount: number }
const latestByIp = new Map();  // ip -> latest data object (online)
const KNOWN_WORKERS_KEY = "pcdash.knownWorkerIPs";


async function bootstrapKnownWorkersOnce(timeoutMs) {
  const ips = Array.from(knownWorkerIPs);
  if (ips.length === 0) return;

  const results = await Promise.all(ips.map(ip => fetchWorkerData(ip, timeoutMs)));

  for (const r of results) {
    if (!r.error) {
      latestByIp.set(r.ip, r);   // only online contribute to totals
    } else {
      latestByIp.delete(r.ip);
    }
  }

  recomputeClusterTotals();
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
  document.getElementById("pollInterval").value = s.pollIntervalMs ?? 1000;
  document.getElementById("missedThreshold").value = s.missedThreshold ?? 3;
}

function validateSettings(s) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(s.ipPrefix)) return `IP Prefix must look like "192.168.1."`;
  if (s.ipStart < 0 || s.ipStart > 255 || s.ipEnd < 0 || s.ipEnd > 255) return "Start/End must be within 0..255";
  if (s.ipStart > s.ipEnd) return "Start must be <= End";
  if (s.probeTimeoutMs < 50) return "Probe timeout too small (min 50ms)";
  if (s.discoveryIntervalMs < 200) return "Discovery interval too small (min 200ms)";
  if (s.pollIntervalMs < 100) return "Poll interval too small (min 100ms)";
  if (s.missedThreshold < 1) return "Missed threshold must be >= 1";
  return null;
}

async function fetchJsonWithTimeout(url, timeoutMs = 1000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchWorkerData(ipAddress, timeoutMs = 1000) {
  try {
    const base = `http://${ipAddress}:9000`;
    const [info, health] = await Promise.all([
      fetchJsonWithTimeout(`${base}/info`, timeoutMs),
      fetchJsonWithTimeout(`${base}/health`, timeoutMs)
    ]);

    return {
      ip: ipAddress,
      error: false,
      workerId: info.worker_id,
      hostname: info.hostname,
      cpuCores: info.cpu_cores,
      cpuThreads: info.cpu_threads,
      memoryMB: info.memory_mb,
      labels: info.labels,
      status: health.status,
      runningJobs: health.running_jobs
    };
  } catch (err) {
    return { ip: ipAddress, error: true, message: err?.message ?? "unreachable" };
  }
}

async function probeWorkerOnce(ipAddress, timeoutMs = 1000) {
  const d = await fetchWorkerData(ipAddress, timeoutMs);
  return d.error ? null : d;
}

function generateIpRange(prefix, start = 1, end = 254) {
  const ips = [];
  for (let i = start; i <= end; i++) ips.push(`${prefix}${i}`);
  return ips;
}

function kickOffDiscovery(ipList, timeoutMs, onWorkerFound, runToken) {
  ipList.forEach(ip => {
    (async () => {
      const data = await probeWorkerOnce(ip, timeoutMs);
      if (runToken !== activeRunToken) return;
      if (data) onWorkerFound(ip, data);
    })();
  });
}

/* ---------- Gauge ---------- */

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end   = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", start.x, start.y,
    "A", r, r, 0, largeArcFlag, 0, end.x, end.y
  ].join(" ");
}



function renderGauge(el, { label, value01, mainText, subText }) {
  const pct = Math.max(0, Math.min(1, value01));
  const start = -225;   // degrees
  const sweep = 270;    // degrees (like your image)
  const end = start + sweep * pct;

  // Build arc path using SVG, two arcs: background + progress
  // We use a normalized viewBox and polar to cartesian conversion.
  const cx = 100, cy = 105, r = 90;

  const polar = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const p0 = polar(start);
  const p1 = polar(start + sweep);
  const pProg = polar(end);

  const largeBg = sweep > 180 ? 1 : 0;
  const largeProg = (sweep * pct) > 180 ? 1 : 0;

  const bgPath = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeBg} 1 ${p1.x} ${p1.y}`;
  const progPath = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeProg} 1 ${pProg.x} ${pProg.y}`;

  el.innerHTML = `
    <div class="gauge">
      <svg viewBox="0 0 200 200" class="gauge-svg" aria-label="${label}">
        <path d="${bgPath}" class="gauge-arc-bg"></path>
        <path d="${progPath}" class="gauge-arc-fg"></path>
      </svg>
      <div class="gauge-center">
        <div class="gauge-main">${mainText}</div>
      </div>
      <div class="gauge-bottom">
        <div class="gauge-sub">${subText ?? ""}</div>
      </div>
    </div>
  `;
}

/* ---------- Aggregation ---------- */

function recomputeClusterTotals() {
  const online = Array.from(latestByIp.values());

  const totalThreads = online.reduce((a, w) => a + (w.cpuThreads ?? 0), 0);
  const usedThreadsProxy = online.reduce((a, w) => a + (w.runningJobs ?? 0), 0);

  const totalRamMb = online.reduce((a, w) => a + (w.memoryMB ?? 0), 0);

  // NOTE: RAM used is not available in your current protocol.
  const usedRamMb = 0;

  const coresPct = totalThreads > 0 ? (usedThreadsProxy / totalThreads) : 0;
  const ramPct = totalRamMb > 0 ? (usedRamMb / totalRamMb) : 0;

  renderGauge(document.getElementById("gauge-cores"), {
    label: "Cores Used",
    value01: coresPct,
    mainText: `${Math.round(coresPct * 100)}%`,
    subText: `${usedThreadsProxy} / ${totalThreads} (proxy)`
  });

  renderGauge(document.getElementById("gauge-ram"), {
    label: "RAM Used",
    value01: ramPct,
    mainText: `${Math.round(ramPct * 100)}%`,
    subText: `${usedRamMb} / ${totalRamMb} MB`
  });

  document.getElementById("cores-sub").textContent =
    `Online workers: ${online.length} • Total threads: ${totalThreads} • Used (proxy): ${usedThreadsProxy}`;

  document.getElementById("ram-sub").textContent =
    `Online workers: ${online.length} • Total RAM: ${totalRamMb} MB`;
}

/* ---------- Control plane ---------- */

function startPolling(intervalMs, timeoutMs, missedThreshold, runToken) {
  async function poll() {
    if (runToken !== activeRunToken) return;

    const ips = Array.from(knownWorkerIPs);
    if (ips.length === 0) return;

    const results = await Promise.all(ips.map(ip => fetchWorkerData(ip, timeoutMs)));
    if (runToken !== activeRunToken) return;

    for (const r of results) {
      if (r.error) {
        const misses = noteWorkerMiss(r.ip);
        if (misses >= missedThreshold) {
          latestByIp.delete(r.ip); // treat as offline for totals
        }
      } else {
        noteWorkerOk(r.ip);
        latestByIp.set(r.ip, r);
      }
    }

    recomputeClusterTotals();
  }

  poll();
  return setInterval(poll, intervalMs);
}

function startDashboard() {
  stopDashboard();

  const settings = {
    ipPrefix: readStr("ipPrefix", "192.168.1."),
    ipStart: readInt("ipStart", 1),
    ipEnd: readInt("ipEnd", 254),
    probeTimeoutMs: readInt("probeTimeout", 1000),
    discoveryIntervalMs: readInt("discoveryInterval", 10000),
    pollIntervalMs: readInt("pollInterval", 1000),
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
        saveKnownWorkerIPs(); // <-- required persistence
      }  
      latestByIp.set(ip, data);
      recomputeClusterTotals();
    }, runToken);
  };

  discoveryTick();
  discoveryTimer = setInterval(discoveryTick, settings.discoveryIntervalMs);

  pollTimer = startPolling(settings.pollIntervalMs, settings.probeTimeoutMs, settings.missedThreshold, runToken);
}

function stopDashboard() {
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (pollTimer) clearInterval(pollTimer);
  discoveryTimer = null;
  pollTimer = null;

  activeRunToken++;
  setUiStatus("Idle");
}

function clearAll() {
  knownWorkerIPs.clear();
  workerState.clear();
  latestByIp.clear();
  saveKnownWorkerIPs();
  recomputeClusterTotals();
  setUiStatus("Idle (cleared)");
}

document.addEventListener("DOMContentLoaded", () => {
  const saved = loadSettings();
  applySettingsToUi(saved ?? {
    ipPrefix: "192.168.1.",
    ipStart: 1,
    ipEnd: 254,
    probeTimeoutMs: 1000,
    discoveryIntervalMs: 10000,
    pollIntervalMs: 1000,
    missedThreshold: 3
  });


  for (const ip of loadKnownWorkerIPs()) {
    if (!knownWorkerIPs.has(ip)) {
      knownWorkerIPs.add(ip);
    }
  }

  const bootstrapTimeout = (saved?.probeTimeoutMs ?? 1000);
  bootstrapKnownWorkersOnce(bootstrapTimeout);

  // initial empty gauges
  recomputeClusterTotals();

  document.getElementById("startBtn").addEventListener("click", startDashboard);
  document.getElementById("stopBtn").addEventListener("click", stopDashboard);
  document.getElementById("clearBtn").addEventListener("click", clearAll);

  startDashboard();
});
