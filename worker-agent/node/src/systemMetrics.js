
import os from "os";
import process from "process";

/**
 * Build the JSON response for GET /info.
 *
 * This should return mostly static information about the worker:
 * - worker_id
 * - hostname
 * - protocol_version
 * - CPU cores/threads
 * - total memory
 * - labels
 */
export function buildInfo(config) {
  const cpus = os.cpus() || [];
  const threads = cpus.length;
  // For now we just approximate cores = threads; we can refine later if needed.
  const cores = threads;

  return {
    worker_id: config.workerId,
    hostname: os.hostname(),
    protocol_version: 1,
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
