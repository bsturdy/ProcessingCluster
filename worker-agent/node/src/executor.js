
import { spawn } from "child_process";

/**
 * Execute a job using Docker based on the job's runtime config.
 *
 * This function:
 * - Builds a `docker run` command from job.runtime
 * - Pipes the full job JSON into the container's stdin
 * - Enforces a max runtime via a timeout
 * - Captures stdout and stderr
 *
 * @param {object} jobRecord - the job record from JobStore (includes .job which is the original job JSON)
 * @returns {Promise<{ exitCode: number | null, stdout: string, stderr: string, errorCode: string | null }>}
 *
 * errorCode is:
 * - null          => normal exit (use exitCode to determine success/failure)
 * - "TIMEOUT"     => job exceeded max_runtime_seconds
 * - "DOCKER_ERROR"=> docker command failed to start or crashed unexpectedly
 */
export function executeJob(jobRecord) {
  const job = jobRecord.job || {};
  const runtime = job.runtime || {};
  const image = runtime.image;
  const envVars = runtime.env || {};
  const limits = runtime.limits || {};

  if (!image || typeof image !== "string") {
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "Missing or invalid runtime.image",
      errorCode: "DOCKER_ERROR"
    });
  }

  const timeoutSeconds = Number(limits.max_runtime_seconds || 10);
  const timeoutMs = timeoutSeconds * 1000;
  const memoryMb = limits.memory_mb ? Number(limits.memory_mb) : null;

  const dockerArgs = buildDockerArgs(image, envVars, memoryMb);

  // The payload we send to the container's stdin.
  // v1: full job JSON, so images can decide what they need.
  const stdinPayload = JSON.stringify(job);

  return runDockerWithTimeout(dockerArgs, stdinPayload, timeoutMs);
}

/**
 * Build the arguments array for `docker run`.
 *
 * @param {string} image
 * @param {object} envVars
 * @param {number | null} memoryMb
 * @returns {string[]} args for `docker` (without the "docker" executable itself)
 */
function buildDockerArgs(image, envVars, memoryMb) {
  const args = ["run", "--rm", "-i"];

  // Memory limit, if provided
  if (memoryMb && !Number.isNaN(memoryMb)) {
    args.push("--memory", `${memoryMb}m`);
  }

  // Environment variables from runtime.env
  for (const [key, value] of Object.entries(envVars)) {
    if (value !== undefined && value !== null) {
      args.push("-e", `${key}=${String(value)}`);
    }
  }

  // Image name
  args.push(image);

  // NOTE: No command override here; we assume the image's default CMD
  // knows how to read JSON from stdin.
  return args;
}

/**
 * Run `docker` with the given arguments, pipe `stdinPayload` into its stdin,
 * enforce a timeout, and capture stdout/stderr.
 *
 * @param {string[]} dockerArgs
 * @param {string} stdinPayload
 * @param {number} timeoutMs
 * @returns {Promise<{ exitCode: number | null, stdout: string, stderr: string, errorCode: string | null }>}
 */
function runDockerWithTimeout(dockerArgs, stdinPayload, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutHandle = null;

    let child;
    try {
      child = spawn("docker", dockerArgs, {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err) {
      return resolve({
        exitCode: null,
        stdout: "",
        stderr: `Failed to start docker: ${err.message || String(err)}`,
        errorCode: "DOCKER_ERROR"
      });
    }

    // Collect stdout
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle normal exit
    child.on("exit", (code) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        exitCode: code,
        stdout,
        stderr,
        errorCode: null
      });
    });

    // Handle spawn errors
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[executor] docker spawn error: ${err.message || String(err)}`,
        errorCode: "DOCKER_ERROR"
      });
    });

    // Enforce timeout
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (finished) return;
        finished = true;
        // Try to kill the docker process
        try {
          child.kill("SIGKILL");
        } catch (e) {
          // ignore
        }
        resolve({
          exitCode: null,
          stdout,
          stderr: stderr + "\n[executor] Job timed out",
          errorCode: "TIMEOUT"
        });
      }, timeoutMs);
    }

    // Send payload to stdin
    if (stdinPayload && stdinPayload.length > 0) {
      child.stdin.write(stdinPayload);
    }
    child.stdin.end();
  });
}
