# Worker Execution Lifecycle 

This document describes how a **worker** should process jobs from submission to completion, including state transitions, Docker execution, logging, and error handling.

It builds on:

- `protocol/JOB_PROTOCOL.md`
- `protocol/WORKER_HTTP_API.md`



## 1. Job States

Each job on a worker progresses through a sequence of states:

- `queued`      — accepted, waiting to start
- `running`     — a container is currently executing the job
- `finished`    — completed successfully (exit code usually 0)
- `failed`      — completed unsuccessfully (non-zero exit, timeout, build error, runtime crash)
- `rejected`    — never started (invalid spec, unsupported runtime, or policy violation)
- `not_found`   — not stored on this worker (used only in lookup responses)



## 2. High-Level Lifecycle

1. **Submission**  
   - Master sends `POST /jobs` with a valid Job object.
   - Worker validates the job:
     - Checks `protocol_version`
     - Validates `job_id`
     - Validates `runtime` (mode, image/build, etc.)
     - Checks local policy (allowed images, modes, limits).
   - If validation fails → return `rejected` with an error.
   - If validation succeeds:
     - Store a job record in `queued` state.
     - Return `accepted: true`, `state: "queued"`.

2. **Queueing & Scheduling**
   - Worker maintains an **in-memory (or persistent) queue** of `queued` jobs.
   - Worker maintains a **concurrency limit**, e.g. `max_concurrent_jobs = 4`.
   - A scheduler loop:
     - Picks `queued` jobs (FIFO or other policy).
     - Starts them if `running_jobs < max_concurrent_jobs`.

3. **Starting Execution**
   - When the worker decides to run a job:
     - Mark job `state = "running"`.
     - Set `started_at` timestamp.
     - Prepare an execution sandbox (temp directory, files, etc.).
     - Invoke Docker according to `runtime`:
       - For `mode = "image"`: `docker run ...`
       - For `mode = "build"` (future): `docker build`, then `docker run`.

4. **Running in Docker**
   - Worker runs the container with:
     - Mounted tmp directory OR input via stdin (implementation-specific).
     - Env vars from `runtime.env`.
     - Resource hints from `runtime.limits` (memory, runtime, etc).
   - The container produces:
     - Exit code
     - Stdout
     - Stderr=

5. **Completion**
   - Worker collects:
     - `exit_code`
     - Captured `stdout`
     - Captured `stderr`
   - Sets:
     - `finished_at` timestamp
   - Determines state:
     - `finished` if exit code = 0 and no fatal runtime error
     - `failed` if exit code != 0, timeout, or Docker-level error

6. **Result Retrieval**
   - Master calls `GET /jobs/{job_id}`.
   - Worker responds with current job record:
     - `state`
     - Timestamps
     - `exit_code`
     - `stdout`
     - `stderr`
     - `error` (if any)

7. **Cleanup**
   - Worker may:
     - Delete temporary files
     - Optionally prune old Docker containers
     - Optionally prune cache images (future)



## 3. Detailed State Transitions

### 3.1 On `POST /jobs` (submission)

- **Input**: Job object

- **Validation passes**:
  - New job record:

    ```jsonc
    {
      "state": "queued",
      "created_at": "...",
      "started_at": null,
      "finished_at": null,
      "exit_code": null,
      "stdout": "",
      "stderr": "",
      "error": null
    }
    ```

- **Validation fails** (bad protocol, unsupported mode, etc.):
  - Do **not** store as a queue job.
  - Return `accepted: false`, `state: "rejected"`, include `error`.


### 3.2 From `queued` → `running`

Triggered by scheduler loop when capacity is available.

- Set:
  - `state = "running"`
  - `started_at = now`
- Start Docker container execution.


### 3.3 From `running` → `finished`

- Container exits with `exit_code = 0`.
- `stdout` and `stderr` captured.
- Set:
  - `state = "finished"`
  - `finished_at = now`
  - `exit_code = 0`
  - `error = null`


### 3.4 From `running` → `failed`

Examples:

- Container exits with non-zero code.
- Docker run error (image not found, network failure, etc).
- Timeout hit (exceeded `max_runtime_seconds`).
- Out of memory / resource violation.

Worker should:

- Set:
  - `state = "failed"`
  - `finished_at = now`
  - `exit_code` = actual exit code or a sentinel.
  - `stderr` / `stdout` as captured.
  - `error.code` = e.g. `RUNTIME_ERROR`, `TIMEOUT`, `DOCKER_ERROR`.
  - `error.message` = human-readable summary.


### 3.5 `rejected` at submission

Examples:

- `protocol_version` ≠ 1
- `runtime.mode = "build"` when worker does not support build.
- Disallowed image (policy).
- `job_id` already exists.

Worker returns a rejection response without storing as a pending job, e.g.:

```json
{
  "accepted": false,
  "job_id": "job-123",
  "state": "rejected",
  "error": {
    "code": "RUNTIME_NOT_SUPPORTED",
    "message": "runtime.mode=build not supported on this worker"
  }
}
