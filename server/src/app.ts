import express from "express";
import { healthRouter } from "./routes/health.js";
import { projectsRouter } from "./routes/projects.js";
import { myTasksRouter } from "./routes/tasks.js";
import { authRouter } from "./routes/auth.js";
import { teamRouter } from "./routes/team.js";
import { demoRouter } from "./routes/demo.js";
import { checkOrigin, requireAuth } from "./lib/auth.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Only private Docker/loopback proxies may provide forwarded client addresses.
  // Express remains inaccessible directly from the public internet in production.
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", "loopback, linklocal, uniquelocal");
  }

  // API responses should not be cached by shared proxies or embedded in other sites.
  // This middleware protects API JSON only; Next.js delivers the web app separately.
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use(express.json({ limit: "16kb" }));
  app.use(checkOrigin);

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/demo", demoRouter);
  app.use("/api/projects", requireAuth, projectsRouter);
  app.use("/api/tasks", requireAuth, myTasksRouter);
  app.use("/api/team", requireAuth, teamRouter);

  app.use("/api", (_request, response) => {
    response.status(404).json({ status: "error", message: "API endpoint not found" });
  });

  // Malformed request bodies are client errors, not internal server failures.
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) return next(error);
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number(error.status) : 500;
    if (status === 413) {
      response.status(413).json({ status: "error", message: "JSON request exceeds the 16 KB limit" });
      return;
    }
    if (status === 400 && error instanceof SyntaxError) {
      response.status(400).json({ status: "error", message: "Invalid JSON request body" });
      return;
    }
    console.error("Request failed:", error);
    response.status(500).json({ status: "error", message: "Unexpected server error" });
  });
  return app;
}
export default createApp();