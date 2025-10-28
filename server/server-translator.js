import express from 'express';
import { logError } from './utils.js';  // Вспомогательные функции для логирования

const router = express.Router();

// Пример обработки запроса на перевод
router.post('/', (req, res) => {
  const { text, targetLanguage } = req.body;  // Получаем текст и целевой язык
  
  // Логирование входных данных
  logError(`Запрос на перевод: ${text} на язык ${targetLanguage}`);

  // Логика перевода (реальный перевод или эмуляция)
  const translatedText = `${text} (переведено на ${targetLanguage})`;

  // Отправка переведённого текста
  res.json({ translatedText });
});

export default router;
