// server/server.js
// Minimal router server — mounts server-*.js modules from same folder.
// Uses process.cwd() for project root and default port 10000.

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname; // modules located here (server-*.js)
const STATIC_DIR = path.join(process.cwd(), "smart"); // use process.cwd()
const PORT = process.env.PORT || 10000;

const app = express();

// Minimal middleware (kept minimal on purpose)
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve client static files from process.cwd()/smart if present
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  console.log(`[main] serving static from ${STATIC_DIR}`);
} else {
  console.log(`[main] static dir not found: ${STATIC_DIR}`);
}

// tiny health check
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// collect modules with init() to call after server.listen
const modulesWithInit = [];

// load/mount all server-*.js modules from SERVER_DIR
(async () => {
  try {
    const files = fs.readdirSync(SERVER_DIR).filter(f => /^server-.*\.js$/.test(f));
    for (const file of files) {
      const modPath = path.join(SERVER_DIR, file);
      try {
        const imported = await import(url.pathToFileURL(modPath).href);
        const basename = file.replace(/^server-|\.js$/g, "");

        if (imported.router) {
          const prefix = imported.prefix || `/${basename}`;
          app.use(prefix, imported.router);
          console.log(`[loader] mounted ${file} -> ${prefix}`);
        } else if (typeof imported.default === "function") {
          // legacy: default export function(app)
          imported.default(app);
          console.log(`[loader] executed default() from ${file}`);
        } else {
          console.log(`[loader] skipped ${file} — no router/default`);
        }

        if (typeof imported.init === "function") {
          modulesWithInit.push({ name: file, init: imported.init });
          console.log(`[loader] scheduled init() for ${file}`);
        }
      } catch (err) {
        console.error(`[loader] error loading ${file}:`, err && err.message ? err.message : err);
      }
    }
  } catch (e) {
    console.error("[loader] could not read server directory:", e && e.message ? e.message : e);
  }
})();

// start server and call init(app, server) on modules that requested it
const server = app.listen(PORT, () => {
  console.log(`🚀 Main server listening on port ${PORT} (cwd: ${process.cwd()})`);
  for (const mod of modulesWithInit) {
    try {
      mod.init(app, server);
      console.log(`[loader] init() called for ${mod.name}`);
    } catch (e) {
      console.error(`[loader] init() error for ${mod.name}:`, e && e.message ? e.message : e);
    }
  }
});

// graceful shutdown
process.on("SIGINT", () => {
  console.log("SIGINT received — shutting down");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down");
  server.close(() => process.exit(0));
});
