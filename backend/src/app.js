import express from "express";
import cors from "cors";
import { config } from "./config.js";
import {
  apiRateLimit,
  authRateLimit,
} from "./middleware/rate-limit.middleware.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentRouter } from "./routes/document.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
    })
  );

  app.use(
    express.json({
      limit: "128kb",
    })
  );

  app.use("/health", healthRouter);
  app.use("/auth", authRateLimit, authRouter);
  app.use("/documents", apiRateLimit, documentRouter);

  app.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        message: "Request body is too large",
      });
    }

    console.error("Unhandled Express error:", error);

    res.status(500).json({
      message: "Internal server error",
    });
  });

  return app;
}