import express from "express";
import { query } from "../db/pool.js";

export const healthRouter = express.Router();

healthRouter.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "collaborative-editor-backend",
  });
});

healthRouter.get("/db", async (req, res) => {
  try {
    const result = await query("SELECT NOW() AS current_time");

    res.json({
      status: "ok",
      database: "connected",
      currentTime: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});