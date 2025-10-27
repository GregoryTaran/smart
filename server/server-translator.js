import express from 'express';
import { logError } from './utils.js';  // Вспомогательные функции для логирования

const router = express.Router();

// Пример обработки запроса на перевод
router.post('/', (req, res) => {
  const { text, targetLanguage } = req.body;  // Получаем текст для перевода и целевой язык

  // Логирование входных данных
  logError(`Запрос на перевод: ${text} на язык ${targetLanguage}`);

  // Пример логики перевода
  // Здесь можно использовать API для реального перевода
  const translatedText = `${text} (переведено на ${targetLanguage})`;

  // Отправляем переведённый текст обратно
  res.json({ translatedText });
});

export default router;
