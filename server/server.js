import express from 'express';
import path from 'path';

// Импортируем роутер для перевода и утилиты
import translationRouter from './server-translator.js';
import { logError } from './utils.js';  // Пример использования утилиты

const app = express();
const PORT = process.env.PORT || 10000;

// Отдаём статику из папки "smart" (например, index.html)
app.use(express.static(path.join(process.cwd(), 'smart')));

// Главный маршрут для отдачи index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'smart', 'index.html'));
});

// Перенаправляем запросы на перевод
app.use('/translate', translationRouter);

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
