// server/server.js
// Minimal router server — mounts server-*.js modules from same folder.
// Uses process.cwd() for project root and default port 10000.
// (Patched: avoid path-to-regexp error by using app.use for SPA fallback)

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname; // modules located here (server-*.js)
const STATIC_DIR = path.join(process.cwd(), "smart"); // serve static from project root /smart
const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();

// Minimal middleware (kept minimal on purpose)
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve client static files from process.cwd()/smart if present
if (fs.existsSync(STATIC_DIR)) {
  // disable default index file handling (we will provide SPA fallback manually)
  app.use(express.static(STATIC_DIR, { index: false }));
  console.log(`[main] serving static from ${STATIC_DIR}`);
} else {
  console.log(`[main] static dir not found: ${STATIC_DIR}`);
}

// tiny health check
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// arrays to track modules for diagnostics / lifecycle
const mountedModules = [];         // { file, prefix }
const modulesWithInit = [];        // { name:file, init:fn }
const modulesWithShutdown = [];    // { name:file, shutdown:fn }

// load/mount all server-*.js modules from SERVER_DIR
(async () => {
  try {
    const files = fs.readdirSync(SERVER_DIR).filter(f => /^server-.*\.js$/.test(f));
    for (const file of files) {
      const modPath = path.join(SERVER_DIR, file);
      try {
        const imported = await import(url.pathToFileURL(modPath).href);
        const basename = file.replace(/^server-|\.js$/g, "");

        // mount router if provided
        if (imported.router) {
          const prefix = imported.prefix || `/${basename}`;
          app.use(prefix, imported.router);
          mountedModules.push({ file, prefix });
          console.log(`[loader] mounted ${file} -> ${prefix}`);
        } else if (typeof imported.default === "function") {
          // legacy: default export function(app)
          try {
            imported.default(app);
            console.log(`[loader] executed default() from ${file}`);
          } catch (e) {
            console.warn(`[loader] default() threw for ${file}:`, e && e.message ? e.message : e);
          }
        } else {
          console.log(`[loader] skipped ${file} — no router/default`);
        }

        if (typeof imported.init === "function") {
          modulesWithInit.push({ name: file, init: imported.init });
          console.log(`[loader] scheduled init() for ${file}`);
        }

        if (typeof imported.shutdown === "function") {
          modulesWithShutdown.push({ name: file, shutdown: imported.shutdown });
          console.log(`[loader] registered shutdown() for ${file}`);
        }
      } catch (err) {
        console.error(`[loader] error loading ${file}:`, err && err.message ? err.message : err);
      }
    }
  } catch (e) {
    console.error("[loader] could not read server directory:", e && e.message ? e.message : e);
  }
})();

// expose simple modules listing for debug
app.get("/_modules", (req, res) => {
  res.json({ mounted: mountedModules, init: modulesWithInit.map(m => m.name), shutdown: modulesWithShutdown.map(m => m.name) });
});

// SPA fallback: use app.use to avoid path-to-regexp issues on some environments.
// Serve index.html for browser navigations (Accept: text/html) when request path isn't API-like.
app.use((req, res, next) => {
  try {
    const accept = req.headers.accept || "";
    const urlPath = req.path || "";
    const isHtml = accept.includes("text/html");
    const isApiLike = urlPath.startsWith("/context") || urlPath.startsWith("/api") || urlPath.startsWith("/_") || urlPath.startsWith("/modules") || urlPath.startsWith("/server");
    if (isHtml && !isApiLike && fs.existsSync(path.join(STATIC_DIR, "index.html"))) {
      return res.sendFile(path.join(STATIC_DIR, "index.html"));
    }
  } catch (e) {
    // ignore and fallback to next
  }
  return next();
});

// start server and call init(app, server) on modules that requested it
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Main server listening on ${HOST}:${PORT} (cwd: ${process.cwd()})`);

  // call module init functions (allow async)
  (async () => {
    for (const mod of modulesWithInit) {
      try {
        // support both sync and async init signatures
        await Promise.resolve(mod.init(app, server));
        console.log(`[loader] init() called for ${mod.name}`);
      } catch (e) {
        console.error(`[loader] init() error for ${mod.name}:`, e && e.message ? e.message : e);
      }
    }
  })();
});

// graceful shutdown: call module shutdown functions, then close server
async function gracefulShutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  // Attempt to call module shutdowns (await each to finish)
  for (const m of modulesWithShutdown) {
    try {
      console.log(`[shutdown] calling shutdown() for ${m.name}`);
      await Promise.resolve(m.shutdown());
      console.log(`[shutdown] done ${m.name}`);
    } catch (e) {
      console.warn(`[shutdown] error during shutdown of ${m.name}:`, e && e.message ? e.message : e);
    }
  }

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });

  // Force exit if not closed in X ms
  setTimeout(() => {
    console.warn("Forcing shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
