/**
 * Smart/SMS/index.js
 * Тестовый модуль "SMS" — демонстрация того, как модуль регистрирует маршруты и WebSocket.
 *
 * API:
 * - POST /api/sms/send  -> принимает { phone, text, sessionId } и возвращает { ok: true }
 * - WebSocket path: /ws/sms  -> отсылает назад эхо для теста
 */

const express = require('express');
const { WebSocketServer } = require('ws');

module.exports.register = function ({ app, httpServer, config, registerWsRoute }) {
  // router — все REST-действия данного модуля будут под /api/sms
  const router = express.Router();

  // Простой тестовый endpoint для очереди SMS (заглушка)
  router.post('/send', (req, res) => {
    const { phone, text, sessionId } = req.body || {};
    // В реальности тут нужно вызвать провайдера SMS, положить в очередь и т.д.
    console.log(`[SMS MODULE] send request`, { phone, sessionId, text });
    // Возвращаем простую заглушку
    return res.json({ ok: true, queued: true, phone, sessionId });
  });

  // Подключаем роутер в основном app под префиксом /api/sms
  app.use('/api/sms', router);

  // --- WebSocket: создаём WSS, но не подключаем к серверу напрямую (noServer: true) ---
  // Сервер (server.js) роутит upgrade-события на основе пути.
  const wss = new WebSocketServer({ noServer: true });

  // При новом подключении можем обмениваться сообщениями
  wss.on('connection', (ws, req) => {
    console.log('[SMS WS] client connected', req.url);

    // Когда приходят сообщения — просто эхо (для тестов)
    ws.on('message', (msg) => {
      console.log('[SMS WS] recv:', msg.toString());
      // Посылаем обратно JSON-ответ-эхо
      try {
        ws.send(JSON.stringify({ echo: msg.toString(), serverTime: Date.now() }));
      } catch (e) {
        console.error('[SMS WS] send error', e);
      }
    });

    ws.on('close', () => {
      console.log('[SMS WS] client disconnected');
    });

    // сразу можно послать приветственное сообщение
    try {
      ws.send(JSON.stringify({ welcome: 'sms-ws', ts: Date.now() }));
    } catch (e) {
      // ignore
    }
  });

  // Регистрируем WS-путь в главном сервере
  // Use path '/ws/sms' — сервер будет маршрутизировать туда upgrade-запросы
  registerWsRoute('/ws/sms', wss);

  // Можно вернуть публичные вспомогательные функции при необходимости
  return {
    name: 'sms',
    // пример: отправить всем подключённым клиентам
    broadcast: (obj) => {
      const data = JSON.stringify(obj);
      wss.clients.forEach((c) => {
        if (c.readyState === c.OPEN) c.send(data);
      });
    },
  };
};
