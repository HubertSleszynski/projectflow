import express from "express";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

if (process.env.NODE_ENV === "production") {
  const origin = process.env.APP_ORIGIN;
  if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
    throw new Error("APP_ORIGIN must be set to the public HTTPS origin in production, e.g. https://projectflow.example.com");
  }
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("projectflow_local_dev")) {
    throw new Error("Configure a unique production DATABASE_URL before starting the API");
  }
}

// Vercel detects this Express entry point and invokes the exported app as a function.
// Keep a local listener for Docker, npm run dev:api and other Node.js hosting.
const app = express();
app.use(createApp());
export default app;

if (!process.env.VERCEL) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Invalid PORT: enter an integer between 1 and 65535.");
    process.exit(1);
  }
  const server = app.listen(port, host, () => {
    console.log(`ProjectFlow API: http://${host}:${port}`);
    console.log(`Health: http://${host}:${port}/api/health`);
    console.log(`Authentication: http://${host}:${port}/api/auth/me`);
    console.log(`Private projects: http://${host}:${port}/api/projects`);
    console.log(`Project tasks: http://${host}:${port}/api/projects/:id/tasks`);
  });
  server.on("error", (error) => { console.error("API server failed:", error); process.exitCode = 1; });

  const shutdown = () => {
    server.close(() => { void prisma.$disconnect().finally(() => process.exit(0)); });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
