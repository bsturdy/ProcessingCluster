
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read config file on device
function loadYamlConfig() {
  const configPath = path.join(__dirname, "..", "config", "worker-default.yaml");

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const fileContent = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(fileContent);
  return parsed || {};
}

//  Translate config profile
function normalizeConfig(raw) {
  // YAML values
  const yamlWorkerId = raw.worker_id || raw.workerId;
  const yamlPort = raw.port;
  const yamlMaxJobs = raw.max_concurrent_jobs || raw.maxConcurrentJobs;
  const yamlLabels = raw.labels || [];

  // Env overrides
  const envWorkerId = process.env.WORKER_ID;
  const envPort = process.env.WORKER_PORT;
  const envMaxJobs = process.env.MAX_CONCURRENT_JOBS;

  return {
    workerId: envWorkerId || yamlWorkerId || "worker-unnamed",
    port: Number(envPort || yamlPort || 9000),
    maxConcurrentJobs: Number(envMaxJobs || yamlMaxJobs || 2),
    labels: Array.isArray(yamlLabels) ? yamlLabels : []
  };
}

const rawConfig = loadYamlConfig();
export const config = normalizeConfig(rawConfig);
