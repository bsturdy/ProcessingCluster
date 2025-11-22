# Worker Architecture 

This document defines the internal architecture and expected structure of a Worker. 

Workers must adhere to:

- `protocol/JOB_PROTOCOL.md`
- `protocol/WORKER_HTTP_API.md`
- `docs/WORKER_LIFECYCLE.md`

Workers remain master-independent. 



## 1. High-Level Components

### 1.1 HTTP API Server 

Implements: 
- GET /info
- GET /health
- POST /jobs
- GET /jobs/{job_id}
- DELETE /jobs/{job_id}

Validates requests, serialises responses.

Stateless; depends on Job Store 


### 1.2 Job Store 

Stores job objects and metadata, provides create/get/update, in-memory for v1

Responsibilities:

- Insert new jobs in queued state
- Lookup jobs by job_id
- Update job fields and state
- Provide job lists (e.g. all queued jobs)


### 1.3 Scheduler 

Enforces max_concurrent_jobs, picks queued jobs (FIFO recommended), triggers execution backend 

Responsibilities:

- Enforce max_concurrent_jobs
- Select queued jobs (FIFO recommended)
- Trigger execution through the Execution Backend
- Prevent multiple starts of the same job


### 1.4 Execution Backend 

Runs Docker images, pull/build images, create temp workspace, pass payload via stdin/files/env, capture stdout/stderr/exit code, enforce timeouts & memory limits 

Responsibilities:

- Pulling or building images (depending on runtime mode)
- Creating a temporary workspace
- Passing job payload (stdin, files, environment variables)
- Running the container
- Capturing stdout, stderr, exit code
- Enforcing timeouts & memory limits


### 1.5 Config & Policy Layer 

worker_id, listen address, concurrency limits, allowed images, allowed runtime modes, default limits, loaded from yaml/json or env vars 

Responsibilities:

- Assigning worker_id
- API listen address
- Maximum concurrency
- Allowed runtime modes
- Allowed images
- Default timeout/memory limits


### 1.6 Monitoring & Metrics (optional)

CPU load, memory, temp, job count, reported via /health 

Responsibilities:

- CPU load
- RAM usage
- Temperature
- Number of running jobs



## 2. Suggested Directory Structure

worker-agent/
  node/
    src/ 
      index.js # entrypoint 
      api.js # HTTP routes 
      jobStore.js # job map 
      scheduler.js # concurrency logic 
      executor.js # Docker logic 
      config.js # loads config 
      systemMetrics.js # health metrics 
    config/ 
      worker-default.yaml 



## 3. Worker Responsibilities Summary

A worker must:
- Accept, validate, store jobs
- Schedule jobs
- Run Docker containers
- Update job state
- Return results
- Enforce runtime limits 

A worker does NOT:
- Perform cluster scheduling
- Persist jobs across restarts (v1)
- Authenticate masters (v1)
- Interpret user code 



## 4. Extensibility

Workers may be implemented in any language:
- Node.js
- Go
- Rust
- C++
- etc... 

Workers can run on:
- Linux servers 
- macOS
- ARM boards
- Containers

Image-based isolation ensures safe execution. 



## 5. Implementation Priorities (v1)

1- Stability 
2- Correct execution 
3- Reproducibility 
4- API consistency 
5- Clear error reporting