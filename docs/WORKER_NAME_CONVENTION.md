# Worker Name Convention

This document defines the **authoritative naming and identity conventions** for a ProcessorCluster worker machine.

It is intended to be used when **provisioning a new worker from scratch** and should be treated as a hard requirement.  
Each worker has a **fixed, hard-coded identity**. There is no dynamic renaming or reuse.

This document covers **all name-bearing layers** of the system to avoid ambiguity, drift, or subtle breakage.



## 1. Identity Layers (Overview)

Each worker has multiple identity layers. All must be set **explicitly and consistently**.

| Layer           | Purpose                                             |
|                 |                                                     |
| Hostname        | OS-level identity (systemd, DHCP, SSH)              |
| Worker ID       | Application-level identity (HTTP API, job routing)  |
| Linux User      | Operational identity (SSH, filesystem, services)    |
| Home Directory  | Filesystem root for worker processes                |
| systemd Service | Persistent worker runtime identity                  |
| IP Address      | Network location (static or DHCP-reserved)          |

No layer should encode information belonging to another layer.



## 2. Canonical Naming Scheme

### 2.1 Worker Index
Each worker is assigned a **unique numeric index**, zero-padded:

001
002
003
...

This index is never reused for a different machine.



### 2.2 Hostname (OS-level)

**Purpose**  
Used by:
- systemd
- DHCP
- SSH
- logging
- monitoring

**Format**
workerXXX

**Examples**
worker001
worker002

markdown
Copy code

**Requirements**
- Must be set via `hostnamectl`
- Must match `/etc/hostname`
- Must match `/etc/hosts` entry
- Must not encode OS type, role, or application details



### 2.3 Worker ID (Application-level)

**Purpose**  
Used by:
- Worker HTTP API (`/info`)
- Master-side discovery and orchestration
- Job attribution

**Format**
workerXXX

**Examples**
worker-macworker001
worker-macworker002

**Requirements**
Must be identical to the OS hostname
Used only inside the application layer
Must not include OS or environment prefixes



### 2.4 Linux User (Operational)

**Purpose**
- SSH login
- Running Node.js worker process
- Owning files and Docker artifacts

**Format**
<os>workerXXX
Where <os> is a human/organizational hint only.

**Rules**
Username does not define worker identity
Username may encode OS or hardware type
Exactly one primary worker user per machine

**Required Groups**
sudo
docker



### 2.5 Home Directory

**Format**
/home/<os>workerXXX

**Example**
/home/macworker001

**Rules**
- Must exist
- Must be owned by worker user
- All worker code, repos, and runtime artifacts live here

---

### 2.6 systemd Service Name

**Purpose**
- Persistent worker runtime
- Boot-time startup
- Crash recovery

**Format**
processor-worker-workerXXX.service

**Examples**
processor-worker-worker001.service
processor-worker-worker002.service

**Rules**
Service name includes the worker ID (hostname)
Service runs as the worker Linux user (<os>workerXXX)
Exactly one worker service per machine



### 2.7 IP Address

**Purpose**
- Network reachability
- Worker discovery

**Policy**
- May be dynamic DHCP **or** static
- If DHCP is used, a **router-side reservation is required**
- IP address is **not encoded into any name**

**Example**
worker001 → 192.168.1.201
worker002 → 192.168.1.202



## 3. Required Consistency Matrix

For a worker with index `002`, the final state must be:

| Layer             | Value                                 |
|                   |                                       |
| Hostname          | `worker002`                           |
| Worker ID         | `worker002`                           |
| Linux User        | `macworker002`                        |
| Home Directory    | `/home/macworker002`                  |
| systemd Service   | `processor-worker-worker002.service`  |
| IP Address        | (assigned / reserved, not encoded)    |

Any deviation is considered **misconfigured**.



## 4. Temporary / Recovery Users

A temporary recovery user may exist during provisioning.

Used only to regain SSH or run bootstrap scripts
Not used by the worker service
May remain present or be deleted after provisioning
Does not participate in any naming or identity layer



## 5. Verification Command (Post-Setup)

After provisioning, the following commands **must** produce expected results:

hostnamectl
whoami
ls /home