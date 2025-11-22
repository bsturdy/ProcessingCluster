
import express from "express";
import { config } from "./config.js";
import { jobStore } from "./jobStore.js";
import { registerRoutes } from "./api.js";
import { Scheduler } from "./scheduler.js";

// Create the Express application
const app = express();

// Middleware to parse JSON request bodies
app.use(express.json());

// Register all API routes (/info, /health, /jobs, etc.)
registerRoutes(app, { jobStore, config });

// Create and start the scheduler
const scheduler = new Scheduler(jobStore, config);
scheduler.start();

// Start listening on the configured port
app.listen(config.port, () => {
  console.log(
    `[worker] Listening on port ${config.port} (worker_id=${config.workerId})`
  );
});

// Optional: basic unhandled error logging
process.on("unhandledRejection", (reason) => {
  console.error("[worker] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[worker] Uncaught exception:", err);
});
