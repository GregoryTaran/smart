import express from 'express';
import { logError } from './utils.js';  // Используем утилиты для логирования

const router = express.Router();

// Пример обработки запроса на перевод
router.post('/', (req, res) => {
  const { text } = req.body;
  
  // Логирование входного текста (с помощью утилиты)
  logError(`Запрос на перевод текста: ${text}`);
  
  // Логика перевода
  const translatedText = `Переведено: ${text}`;

  // Отправляем переведённый текст
  res.json({ translatedText });
});

export default router;
