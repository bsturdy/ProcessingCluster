
/**
 * In-memory job store.
 *
 * Holds the state of all jobs on this worker
 * 
 * It matches the lifecycle + API docs:
 * - job_id
 * - state
 * - created_at / started_at / finished_at
 * - exit_code, stdout, stderr, error
 * - job (the original job JSON from the master)
 */

class JobStore {
  constructor() {
    // Map<job_id, jobRecord>
    this.jobs = new Map();
  }


  /**
   * Create a new job record.
   * - jobId: string
   * - jobObject: the original job JSON from the master (as passed to POST /jobs)
   *
   * Throws if a job with this id already exists.
   */
  createJob(jobId, jobObject) {
    if (this.jobs.has(jobId)) {
      throw new Error(`Job with id ${jobId} already exists`);
    }

    const now = new Date().toISOString();

    const record = {
      job_id: jobId,
      state: "queued",
      created_at: now,
      started_at: null,
      finished_at: null,
      exit_code: null,
      stdout: "",
      stderr: "",
      error: null,
      job: jobObject 
    };

    this.jobs.set(jobId, record);
    return record;
  }


  /**
   * Get a job record by id.
   * Returns null if no such job exists.
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }


  /**
   * Update fields on an existing job record.
   * - partialUpdate is an object (e.g., { state: "running", started_at: "..." }).
   * Returns the updated record, or null if job does not exist.
   */
  updateJob(jobId, partialUpdate) {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return null;
    }

    const updated = { ...existing, ...partialUpdate };
    this.jobs.set(jobId, updated);
    return updated;
  }


  /**
   * Return an array of all jobs currently in the given state.
   * For example: getJobsByState("queued").
   */
  getJobsByState(state) {
    const result = [];
    for (const job of this.jobs.values()) {
      if (job.state === state) {
        result.push(job);
      }
    }
    return result;
  }


  /**
   * Get how many jobs are currently running.
   * Used for /health and for the scheduler's concurrency limit.
   */
  getRunningJobCount() {
    return this.getJobsByState("running").length;
  }


  /**
   * Get total number of jobs tracked by this worker.
   * Useful for debugging or metrics.
   */
  getTotalJobCount() {
    return this.jobs.size;
  }
}


// Export a singleton instance.
export const jobStore = new JobStore();
