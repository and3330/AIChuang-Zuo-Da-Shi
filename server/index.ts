import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
// Telegram bot disabled — was causing 409 polling conflicts when prod and
// dev both polled the same bot token. Re-enable by restoring this import
// and the startTelegramBot() call in server.listen below.
// import { startTelegramBot } from "./telegramBot";

const app = express();
app.set("trust proxy", 1);
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "ai-image-generator-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  // On startup: reset any scenes/stories stuck in "generating" due to server restart
  storage.getAllStoryGenerations().then(async (stories) => {
    let fixedCount = 0;
    for (const story of stories) {
      try {
        // Reset whole-story stuck state
        if (story.status === "generating" || story.status === "pending") {
          await storage.updateStoryGeneration(story.id, { status: "failed" });
          fixedCount++;
          continue;
        }
        // Reset individual stuck scenes within completed stories
        if (!story.scenes) continue;
        const scenes = JSON.parse(story.scenes);
        let changed = false;
        for (const scene of scenes) {
          if (scene.status === "generating") {
            scene.status = "failed";
            changed = true;
          }
        }
        if (changed) {
          await storage.updateStoryGeneration(story.id, { scenes: JSON.stringify(scenes) });
          fixedCount++;
        }
      } catch { /* skip malformed rows */ }
    }
    if (fixedCount > 0) log(`♻️  Reset ${fixedCount} stuck story generation(s) on startup`);
  }).catch(err => console.error("Error recovering stuck story generations:", err));

  storage.fixStripeTransactionTypes().then(fixed => {
    if (fixed > 0) {
      log(`Fixed ${fixed} Stripe transaction(s) from 'refund' to 'topup'`);
    }
  }).catch(err => console.error("Error fixing Stripe transactions:", err));

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    // startTelegramBot();
  });
})();
