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

// Allow dashboards / masters (cluster UI etc.) to call the worker API
app.use(cors());
app.use(express.json());

// Optional: serve static assets from ./public if you ever use it
app.use(express.static(path.join(__dirname, "public")));

// Scheduler: manages queued/running jobs & concurrency
const scheduler = new Scheduler(jobStore, {
  maxConcurrentJobs: config.maxConcurrentJobs
});
scheduler.start();


// `registerRoutes` expects a deps object: { jobStore, config }
registerRoutes(app, { jobStore, config });

app.listen(config.port, () => {
  console.log(
    `[worker] Listening on port ${config.port} (worker_id=${config.workerId})`
  );
});
