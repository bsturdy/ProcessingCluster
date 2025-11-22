
## Job Protocol v1

This document defines the JSON format that any master uses to submit jobs to any worker in the ProcessorCluster system. 

Workers are master-independent: as long as a master sends jobs using this format, the worker can run them. 



## 1. Top-Level Job Object 

A job is a single JSON object: 

{ 
    "protocol_version": 1, 
    "job_id": "job-123", 
    "task": 
    { 
        "type": "compile_and_run_cpp", 
        "payload": 
        { 
            "source_code": "int main(){ return 0; }" 
        } 
    }, 
    "runtime": 
    { 
        "mode": "image", 
        "image": "dynamic-cpp-runner:1.0.0", 
        "cmd": [],
        "env": 
        { 
            "TIMEOUT_SECONDS": "3" 
        }, 
        "limits": 
        { 
            "memory_mb": 512,
            "max_runtime_seconds": 5 
        } 
    } 
 }

### Required fields
 
 - protocol_version: integer, currently 1
 - job_id: unique string chosen by the master
 - task: logical human-readable description of what to do
 - runtime: how to run it (Docker details) 
 
 

## 2. protocol_version 
 
 "protocol_version": 1 Must be 1 for this version of the protocol. Workers must reject other versions. 
 
 

## 3. job_id
 
 "job_id": "job-123" String identifier, unique (per worker). Used with GET /jobs/{job_id} to query status/results. 
 
 

## 4. task object 
 
 Describes what the job is logically doing. 
 
 "task": 
 { 
    "type": "compile_and_run_cpp", 
    "payload": 
    { 
        "source_code": "#include ... "
    } 
} 



## 5. runtime object

Describes how to execute the job using Docker. 

Two modes:
- image: run an existing image.
- build: (future) build an image and run it. 

### runtime.mode = "image"
"runtime": 
{ 
    "mode": "image", 
    "image": "dynamic-cpp-runner:1.0.0", 
    "cmd": [], "env": 
    { 
        "TIMEOUT_SECONDS": "3" 
    }, 
    "limits": 
    { 
        "memory_mb": 512, 
        "max_runtime_seconds": 5 
    } 
} 

### runtime.mode = "build" 
Reserved for later. Allows Dockerfile and context files to be included directly in the job. 



## 6. Error Handling 

Workers should use consistent error structures when rejecting a job: 
{ 
    "accepted": false, 
    "job_id": "job-123", 
    "state": "rejected", 
    "error": 
    { 
        code": "ERROR_CODE", 
        "message": "Human-readable" 
    } 
} 



## 7. Notes

Workers do not need compilers or interpreters installed. Everything required lives inside Docker images. 

This protocol allows workers to remain master-independent by standardizing how jobs are defined and executed.