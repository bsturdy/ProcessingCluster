
import { buildInfo, buildHealth } from "./systemMetrics.js";

/**
 * Register all HTTP routes on the given Express app.
 *
 * This module does NOT create the Express app or start listening;
 * that's the job of index.js. Here we just attach handlers.
 *
 * @param {import("express").Express} app
 * @param {object} deps
 * @param {import("./jobStore.js").jobStore} deps.jobStore
 * @param {import("./config.js").config} deps.config
 */

export function registerRoutes(app, { jobStore, config }) {

  /**
   * GET /info
   *
   * Returns static worker information.
   */
  app.get("/info", (req, res) => {
    const info = buildInfo(config);
    res.json(info);
  });


  /**
   * GET /health
   *
   * Returns dynamic health and load information for this worker.
   */
  app.get("/health", (req, res) => {
    const runningJobs = jobStore.getRunningJobCount();
    const maxConcurrentJobs = config.maxConcurrentJobs;

    const health = buildHealth({ runningJobs, maxConcurrentJobs });
    res.json(health);
  });


  /**
   * POST /jobs
   *
   * Submit a job to this worker.
   *
   * Expected body: the Job object from JOB_PROTOCOL.md.
   */
  app.post("/jobs", (req, res) => {
    const job = req.body;

    // Basic shape validation
    const validationError = validateJobRequest(job, config);
    if (validationError) {
      return res.status(400).json({
        accepted: false,
        job_id: job?.job_id ?? null,
        state: "rejected",
        error: {
          code: validationError.code,
          message: validationError.message
        }
      });
    }

    const jobId = job.job_id;

    try {
      const record = jobStore.createJob(jobId, job);

      return res.status(202).json({
        accepted: true,
        job_id: record.job_id,
        state: record.state
      });
    } catch (err) {
      // Most likely: duplicate job id
      return res.status(409).json({
        accepted: false,
        job_id: jobId,
        state: "rejected",
        error: {
          code: "JOB_ID_ALREADY_EXISTS",
          message: err.message || "Job with this id already exists on this worker"
        }
      });
    }
  });


  /**
   * GET /jobs/:job_id
   *
   * Fetch job status and results.
   */
  app.get("/jobs/:job_id", (req, res) => {
    const jobId = req.params.job_id;
    const record = jobStore.getJob(jobId);

    if (!record) {
      return res.status(404).json({
        job_id: jobId,
        state: "not_found"
      });
    }

    // Build response object
    const response = {
      job_id: record.job_id,
      state: record.state,
      created_at: record.created_at,
      started_at: record.started_at,
      finished_at: record.finished_at,
      exit_code: record.exit_code,
      stdout: record.stdout,
      stderr: record.stderr,
      error: record.error
    };

    return res.json(response);
  });


  /**
   * DELETE /jobs/:job_id
   *
   * Request cancellation.
   * v1 behaviour:
   * - If job is still queued, mark as failed with CANCELLED.
   * - If job is running, we *acknowledge* the request but
   *   do not actually kill the container yet (future work).
   */
  app.delete("/jobs/:job_id", (req, res) => {
    const jobId = req.params.job_id;
    const record = jobStore.getJob(jobId);

    if (!record) {
      return res.status(404).json({
        job_id: jobId,
        state: "not_found"
      });
    }

    if (record.state === "queued") {
      const now = new Date().toISOString();
      const updated = jobStore.updateJob(jobId, {
        state: "failed",
        finished_at: now,
        error: {
          code: "CANCELLED",
          message: "Job was cancelled before it started running"
        }
      });

      return res.status(200).json({
        job_id: updated.job_id,
        state: updated.state,
        note: "Job cancelled before start"
      });
    }

    // For running jobs, v1 doesn't actually kill the container yet.
    // We just report that cancellation is not implemented.
    return res.status(202).json({
      job_id: record.job_id,
      state: record.state,
      note: "Cancellation for running jobs is not implemented in v1"
    });
  });
}


/**
 * Validate an incoming job object according to JOB_PROTOCOL v1.
 *
 * Returns:
 * - null if valid
 * - { code, message } if invalid
 */
function validateJobRequest(job, config) {
  if (!job || typeof job !== "object") {
    return {
      code: "INVALID_BODY",
      message: "Request body must be a JSON object"
    };
  }

  if (job.protocol_version !== 1) {
    return {
      code: "UNSUPPORTED_PROTOCOL_VERSION",
      message: `Unsupported protocol_version: ${job.protocol_version}. Only version 1 is supported.`
    };
  }

  if (!job.job_id || typeof job.job_id !== "string") {
    return {
      code: "MISSING_JOB_ID",
      message: "job_id must be a non-empty string"
    };
  }

  if (!job.runtime || typeof job.runtime !== "object") {
    return {
      code: "MISSING_RUNTIME",
      message: "runtime must be provided and must be an object"
    };
  }

  const mode = job.runtime.mode;
  if (mode !== "image" && mode !== "build") {
    return {
      code: "BAD_RUNTIME_MODE",
      message: `runtime.mode must be 'image' or 'build', got '${mode}'`
    };
  }

  // v1: only 'image' is supported by default
  if (mode === "build") {
    return {
      code: "RUNTIME_NOT_SUPPORTED",
      message: "runtime.mode='build' is not supported on this worker"
    };
  }

  if (!job.runtime.image || typeof job.runtime.image !== "string") {
    return {
      code: "MISSING_IMAGE",
      message: "runtime.image must be a non-empty string when mode='image'"
    };
  }

  // Optional: enforce allow-list of images from config
  if (Array.isArray(config.allowedImages) && config.allowedImages.length > 0) {
    const allowed = config.allowedImages;
    const image = job.runtime.image;

    const isAllowed = allowed.some((pattern) => {
      // Very simple pattern: "name:*" means "startsWith('name:')"
      if (pattern.endsWith(":*")) {
        const prefix = pattern.slice(0, -2); // remove ":*"
        return image.startsWith(prefix + ":");
      }
      // Exact match
      return image === pattern;
    });

    if (!isAllowed) {
      return {
        code: "IMAGE_NOT_ALLOWED",
        message: `Image '${image}' is not allowed on this worker`
      };
    }
  }

  return null;
}
