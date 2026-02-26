import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import http from "http";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";

const app = express();
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || "ai-image-generator-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
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
    if (path !== "/api/health") {
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

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") console.error("stdout error:", err);
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") console.error("stderr error:", err);
});

process.on("unhandledRejection", (reason) => {
  try { console.error("Unhandled promise rejection:", reason); } catch {}
});

process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
  try { console.error("Uncaught exception:", err); } catch {}
});

process.on("exit", (code) => {
  console.error(`[PROCESS EXIT] Node.js exiting with code ${code} at ${new Date().toISOString()}`);
});

const _realExit = process.exit.bind(process);
(process as any).exit = (code?: number) => {
  console.error(`[EXIT INTERCEPTED] process.exit(${code}) called from:`, new Error("exit trace").stack);
  _realExit(code);
};

process.on("SIGTERM", () => {
  console.error("[SIGNAL] Received SIGTERM - process will terminate");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[SIGNAL] Received SIGINT - process will terminate");
  process.exit(0);
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`Request error [${status}]:`, err.message || err);
    res.status(status).json({ message });
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
  storage.fixStripeTransactionTypes().then(fixed => {
    if (fixed > 0) {
      log(`Fixed ${fixed} Stripe transaction(s) from 'refund' to 'topup'`);
    }
  }).catch(err => console.error("Error fixing Stripe transactions:", err));

  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;

  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    let tick = 0;
    const keepAliveInterval = setInterval(() => {
      tick++;
      const req = http.request({
        hostname: "localhost",
        port,
        path: "/api/health",
        method: "GET",
      }, (res) => {
        res.resume();
        if (tick <= 5 || tick % 60 === 0) log(`ping #${tick} → ${res.statusCode}`);
      });
      req.on("error", () => {});
      req.end();
    }, 3000);
  });
})();
