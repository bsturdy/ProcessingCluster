
## Worker HTTP API v1

All workers expose a universal HTTP interface at http://[WorkerIP]:9000

All requests/responses are JSON.



## 1. GET /info

Returns static worker information.

Example Response:
{
    "worker_id": "macworker001",
    "hostname": "macworker001",
    "protocol_version": 1,
    "cpu_cores": 4,
    "cpu_threads": 8,
    "memory_mb": 16000,
    "labels": ["mac", "i7-3615QM"]
}



## 2. GET /health

Returns dynamic worker health.

{
    "status": "ok",
    "uptime_seconds": 12345,
    "load_average": [0.10, 0.25, 0.20],
    "running_jobs": 1,
    "max_concurrent_jobs": 4,
    "temperature_c": 62.5
}



## 3. POST /jobs

Submit a job.

Success:
{
    "accepted": true,
    "job_id": "job-123",
    "state": "queued"
}

Rejected:
{
    "accepted": false,
    "state": "rejected",
    "error": { "code": "BAD_RUNTIME_MODE", "message": "..." }
}



## 4. GET /jobs/{job_id}

Fetch job status or results.

Example:
{
    "job_id": "job-123",
    "state": "finished",
    "stdout": "Hello!",
    "stderr": "",
    "exit_code": 0
}



## 5. DELETE /jobs/{job_id}

Request cancellation.

{
    "job_id": "job-123",
    "state": "running",
    "note": "Cancellation requested"
}
