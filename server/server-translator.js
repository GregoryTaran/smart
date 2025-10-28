// server/server-translator.js
// Модуль "translator" для модульного главного сервера.
// - Экспорт: `router`, `prefix` и опционально `init` (здесь init noop).
// - Хранение/логи/временные файлы ориентируются на process.cwd().
// - Важно: здесь только логика модуля — главный сервер монтирует router.

import express from "express";
import fs from "fs";
import path from "path";

export const prefix = "/translate";        // точка монтирования: /translate
export const router = express.Router();    // основной Express Router модуля

// Используем process.cwd() как корень проекта — согласовано с архитектурой
const ROOT = process.cwd();
const MODULE_STORAGE = path.join(ROOT, "server-data", "translator");
try { fs.mkdirSync(MODULE_STORAGE, { recursive: true }); } catch (e) { /* ignore */ }

/**
 * GET /status
 * Простой health для модуля (полезно для smoke-tests и деплоя)
 */
router.get("/status", (req, res) => {
  return res.json({
    ok: true,
    module: "translator",
    ts: Date.now(),
    root: ROOT
  });
});

/**
 * POST /
 * Ожидает JSON: { text: string, lang?: string }
 * Возвращает: { result: string, meta: {...} }
 *
 * Здесь — место для вставки вашей старой логики перевода.
 * Постарайтесь вынести сложные функции в отдельные helper-файлы внутри server/ если нужно.
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const lang = body.lang || "auto";

    if (!text) return res.status(400).json({ error: "missing_text" });

    // ======= TODO: вставьте сюда старую логику перевода (oldTranslate) ========
    // Пример-шаблон (замените на реальный вызов):
    // const result = await oldTranslate({ text, lang, options: {...} });
    //
    // Для безопасности пока делаем нейтральный миграционный ответ:
    const result = `[TRANSLATOR-MIGRATED] (${lang}) ${text}`;
    // ========================================================================

    // Лёгкая запись лога модуля (не критично — оборачиваем в try/catch)
    try {
      const logLine = `${new Date().toISOString()} | lang=${lang} | text=${text.slice(0,200)}\n`;
      fs.appendFileSync(path.join(MODULE_STORAGE, "requests.log"), logLine);
    } catch(e) { /* ignore logging errors */ }

    return res.json({ result, meta: { length: result.length } });
  } catch (err) {
    console.error("[translator] unexpected error:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "translator_internal", message: err && err.message ? err.message : String(err) });
  }
});

/**
 * init(app, server)
 * Модуль предоставляет hook на инициализацию с http.Server, но переводчику WS обычно не нужен.
 * Оставляем noop, но экспортируем для совместимости.
 */
export function init(app, server) {
  // noop — translator не поднимает дополнительных протоколов по умолчанию
  console.log("[translator] init() called (no-op)");
}
