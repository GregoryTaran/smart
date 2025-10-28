// server/server-translator.js
// Translator module. Exports { router, prefix, init? }.
// Main server will mount it at prefix (default '/translate').

import express from "express";
import fs from "fs";
import path from "path";

export const prefix = "/translate";
export const router = express.Router();

// Optional: directory for module-specific files — use process.cwd()
const MODULE_ROOT = process.cwd();
const LOG_DIR = path.join(MODULE_ROOT, "server-data");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

router.get("/status", (req, res) => {
  res.json({ ok: true, module: "translator", ts: Date.now(), root: MODULE_ROOT });
});

/**
 * POST /
 * Body: { text: string, lang?: string }
 * Replace the mock logic below with your real translator implementation.
 */
router.post("/", async (req, res) => {
  try {
    const { text, lang } = req.body || {};
    if (!text) return res.status(400).json({ error: "missing_text" });

    // ====== TODO: paste your old translator logic here ======
    // Example placeholder synchronous logic (safe fallback):
    const result = `[TRANSLATOR-MIGRATED] (${lang || "auto"}) ${String(text)}`;
    // =======================================================

    // optional: write simple log for audit
    try {
      fs.appendFileSync(path.join(LOG_DIR, "translator.log"), `${new Date().toISOString()} | ${lang||"auto"} | ${String(text).slice(0,200)}\n`);
    } catch (e) {
      // ignore logging errors
    }

    return res.json({ result, meta: { length: result.length } });
  } catch (err) {
    console.error("[translator] error:", err && err.message ? err.message : err);
    return res.status(500).json({ error: err && err.message ? err.message : "translator_error" });
  }
});

// optional init function (not needed here) — exported if required
export function init(app, server) {
  // no-op by default; translator doesn't need WS. But leaving hook for future.
  console.log("[translator] init() called (no-op)");
}
