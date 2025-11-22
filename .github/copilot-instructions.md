# Copilot Instructions for ProcessingCluster

## Project Overview
This repository implements a distributed job processing cluster. The main components are:
- **worker-agent/node/**: Node.js worker agent responsible for executing jobs, reporting system metrics, and communicating with the cluster controller.
- **protocol/**: Contains documentation for job protocols and worker HTTP API.
- **examples/**: Sample jobs and curl requests for testing and demonstration.

## Architecture & Data Flow
- **Workers** (in `worker-agent/node/`) poll for jobs, execute them, and report results/status via HTTP APIs defined in `protocol/WORKER_HTTP_API.md`.
- **Job Protocols** are documented in `protocol/JOB_PROTOCOL.md`.
- **System metrics** are collected in `worker-agent/node/src/systemMetrics.js` and reported to the controller.
- **Job scheduling** logic is in `worker-agent/node/src/scheduler.js`.
- **Configuration** is managed via YAML files in `worker-agent/node/config/`.

## Developer Workflows
- **No build step required** for Node.js worker agent; run directly with Node.js.
- **Configuration**: Edit `worker-agent/node/config/worker-default.yaml` to change worker settings.
- **Debugging**: Use console logging in source files. Key entry point: `worker-agent/node/src/index.js`.
- **Testing**: Use sample jobs in `examples/jobs/` and curl scripts in `examples/curl/`.

## Project-Specific Patterns
- **Job Store**: All job state is managed in-memory in `worker-agent/node/src/jobStore.js`.
- **Scheduler**: Custom job scheduling logic in `worker-agent/node/src/scheduler.js`.
- **API Layer**: HTTP endpoints are defined in `worker-agent/node/src/api.js`.
- **Metrics**: System metrics reporting is centralized in `systemMetrics.js`.
- **Configuration**: Always load settings from YAML, not environment variables.

## Integration Points
- **External Communication**: Workers communicate with the cluster controller via HTTP as per `protocol/WORKER_HTTP_API.md`.
- **Job Protocol**: All jobs must conform to the format in `protocol/JOB_PROTOCOL.md`.

## Conventions
- **Node.js only** in `worker-agent/node/`.
- **YAML for config**; do not use `.env` or JSON for configuration.
- **All job logic is synchronous** unless otherwise documented.
- **Use provided examples** for testing and debugging.

## Key Files & Directories
- `worker-agent/node/src/index.js`: Worker agent entry point
- `worker-agent/node/config/worker-default.yaml`: Worker configuration
- `worker-agent/node/src/scheduler.js`: Job scheduling logic
- `worker-agent/node/src/jobStore.js`: In-memory job state
- `protocol/WORKER_HTTP_API.md`: Worker API documentation
- `protocol/JOB_PROTOCOL.md`: Job protocol documentation
- `examples/jobs/`, `examples/curl/`: Example jobs and test scripts

---

**For AI agents:**
- Always reference protocol documentation before implementing new features.
- Follow the configuration and job protocol strictly.
- Use existing examples for validation.
- Document any new patterns or conventions in this file.
