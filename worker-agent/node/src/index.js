
import express from "express";
import { config } from "./config.js";
import { registerRoutes } from "./api.js";
import { Scheduler } from "./scheduler.js";
import { jobStore } from "./jobStore.js";
import { gatherSystemMetrics } from "./systemMetrics.js";

// NEW:
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Allow browser dashboards
app.use(cors());
app.use(express.json());

// (optional) still nice to serve static files if you want later:
app.use(express.static(path.join(__dirname, "public")));

const scheduler = new Scheduler(jobStore, {
  maxConcurrentJobs: config.maxConcurrentJobs,
  getSystemMetrics: gatherSystemMetrics
});
scheduler.start();

registerRoutes(app, jobStore, scheduler);

app.listen(config.port, () => {
  console.log(
    `[worker] Listening on port ${config.port} (worker_id=${config.workerId})`
  );
});
