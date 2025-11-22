import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config.js";
import { registerRoutes } from "./api.js";
import { Scheduler } from "./scheduler.js";
import { jobStore } from "./jobStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Allow dashboards / masters from other origins (cluster UI etc.)
app.use(cors());
app.use(express.json());

// Optional: serve static assets from ./public if you want per-worker pages
app.use(express.static(path.join(__dirname, "public")));

// Scheduler: controls queued/running jobs, no metrics involved here
const scheduler = new Scheduler(jobStore, {
  maxConcurrentJobs: config.maxConcurrentJobs
});
scheduler.start();

// Register HTTP routes (/info, /health, /jobs, etc.)
registerRoutes(app, jobStore, scheduler);

// Start HTTP server
app.listen(config.port, () => {
  console.log(
    `[worker] Listening on port ${config.port} (worker_id=${config.workerId})`
  );
});
