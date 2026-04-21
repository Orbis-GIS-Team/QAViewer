import cors from "cors";
import express from "express";

import { config } from "./config.js";
import { authenticateRequest } from "./lib/auth.js";
import { pool } from "./lib/db.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import layerRoutes from "./routes/layers.js";
import questionAreaRoutes from "./routes/questionAreas.js";

export function createApp(): express.Application {
  const app = express();

  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", message: "Database connection failed." });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", authenticateRequest, adminRoutes);
  app.use("/api/dashboard", authenticateRequest, dashboardRoutes);
  app.use("/api/layers", authenticateRequest, layerRoutes);
  app.use("/api/question-areas", authenticateRequest, questionAreaRoutes);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ message: "Unexpected server error." });
  });

  return app;
}
