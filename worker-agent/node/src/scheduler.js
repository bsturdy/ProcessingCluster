
import { executeJob } from "./executor.js";

/**
 * Scheduler
 *
 * Periodically:
 *  - Checks how many jobs are running.
 *  - If there is free capacity, takes jobs from 'queued'.
 *  - Marks them as 'running' and calls executeJob(jobRecord).
 *  - When executeJob finishes, updates the job as 'finished' or 'failed'.
 */
export class Scheduler {
  /**
   * @param {import("./jobStore.js").jobStore} jobStore
   * @param {import("./config.js").config} config
   */
  constructor(jobStore, config) {
    this.jobStore = jobStore;
    this.config = config;

    this._intervalHandle = null;
    this._tickInProgress = false;
    this._intervalMs = 500; // how often to check the queue
  }

  /**
   * Start the periodic scheduling loop.
   * Safe to call multiple times; only starts once.
   */
  start() {
    if (this._intervalHandle) {
      return; // already running
    }

    this._intervalHandle = setInterval(() => {
      this._tick();
    }, this._intervalMs);

    console.log(
      `[scheduler] Started with interval=${this._intervalMs}ms, maxConcurrentJobs=${this.config.maxConcurrentJobs}`
    );
  }

  /**
   * Stop the scheduler loop.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
      console.log("[scheduler] Stopped");
    }
  }

  /**
   * One scheduling tick:
   *  - Check running jobs
   *  - Find queued jobs
   *  - Start as many as we have capacity for
   */
  async _tick() {
    if (this._tickInProgress) {
      // Avoid overlapping ticks if one takes longer than the interval.
      return;
    }

    this._tickInProgress = true;

    try {
      const runningCount = this.jobStore.getRunningJobCount();
      const maxConcurrent = this.config.maxConcurrentJobs;

      const availableSlots = maxConcurrent - runningCount;
      if (availableSlots <= 0) {
        // No capacity, nothing to do this tick
        return;
      }

      const queuedJobs = this.jobStore.getJobsByState("queued");
      if (queuedJobs.length === 0) {
        // No queued jobs
        return;
      }

      const toStart = queuedJobs.slice(0, availableSlots);

      for (const jobRecord of toStart) {
        this._startJob(jobRecord).catch((err) => {
          console.error(
            `[scheduler] Unexpected error while starting job ${jobRecord.job_id}:`,
            err
          );
        });
      }
    } finally {
      this._tickInProgress = false;
    }
  }

  /**
   * Transition a job from queued -> running, then call executeJob,
   * then update it to finished/failed depending on the result.
   */
  async _startJob(jobRecord) {
    const jobId = jobRecord.job_id;

    // Mark the job as running
    const now = new Date().toISOString();
    const runningRecord = this.jobStore.updateJob(jobId, {
      state: "running",
      started_at: now
    });

    if (!runningRecord) {
      // Job disappeared or was cancelled between being picked and here
      console.warn(
        `[scheduler] Job ${jobId} no longer exists or could not be updated to running`
      );
      return;
    }

    console.log(`[scheduler] Starting job ${jobId} with image=${runningRecord.job?.runtime?.image}`);

    // Execute the job in Docker
    const result = await executeJob(runningRecord);

    const finishedAt = new Date().toISOString();

    let finalState = "finished";
    let error = null;

    if (result.errorCode === "TIMEOUT") {
      finalState = "failed";
      error = {
        code: "TIMEOUT",
        message: "Job exceeded max_runtime_seconds"
      };
    } else if (result.errorCode === "DOCKER_ERROR") {
      finalState = "failed";
      error = {
        code: "DOCKER_ERROR",
        message: "Docker failed to run the job"
      };
    } else if (typeof result.exitCode === "number" && result.exitCode !== 0) {
      finalState = "failed";
      error = {
        code: "NON_ZERO_EXIT",
        message: `Job exited with code ${result.exitCode}`
      };
    }

    const updated = this.jobStore.updateJob(jobId, {
      state: finalState,
      finished_at: finishedAt,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      error
    });

    if (!updated) {
      console.warn(
        `[scheduler] Job ${jobId} disappeared before completion could be recorded`
      );
      return;
    }

    console.log(
      `[scheduler] Job ${jobId} completed with state=${updated.state}, exit_code=${updated.exit_code}, errorCode=${result.errorCode}`
    );
  }
}
