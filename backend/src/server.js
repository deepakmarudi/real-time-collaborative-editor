import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import {
  flushAllDocumentSnapshots,
} from "./realtime/document-persistence.js";
import { authenticateSocket } from "./sockets/socket-auth.js";
import {
  registerDocumentSocketHandlers,
} from "./sockets/document.socket.js";

const SHUTDOWN_TIMEOUT_MS = 10000;
const MAX_SOCKET_MESSAGE_BYTES = 128 * 1024;

const app = createApp();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.clientUrl,
    credentials: true,
  },
  maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES,
});

app.set("io", io);

let isShuttingDown = false;

io.use(authenticateSocket);

io.on("connection", async (socket) => {
  console.log(
    "Socket connected:",
    socket.id,
    socket.user.email
  );

  await socket.join(`user:${socket.user.id}`);

  registerDocumentSocketHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

httpServer.listen(config.port, () => {
  console.log(
    `Backend server running on port ${config.port}`
  );
});

async function closeSocketServer() {
  await new Promise((resolve) => {
    io.close(() => resolve());
  });
}

async function shutdown(signal) {
  if (isShuttingDown) return;

  isShuttingDown = true;

  console.log(`${signal} received. Shutting down...`);

  const forcedShutdownTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forcedShutdownTimer.unref();

  try {
    await closeSocketServer();
    console.log("Socket server closed");

    await flushAllDocumentSnapshots();
    console.log("Pending document snapshots persisted");

    await pool.end();
    console.log("Database pool closed");

    clearTimeout(forcedShutdownTimer);
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);

    clearTimeout(forcedShutdownTimer);

    try {
      await pool.end();
    } catch (poolError) {
      console.error(
        "Database pool shutdown failed:",
        poolError
      );
    }

    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});