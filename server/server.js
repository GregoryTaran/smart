import express from 'express';
import path from 'path';

// Импортируем роутер для перевода
import translatorRouter from './server-translator.js';  // Теперь правильно

const app = express();
const PORT = process.env.PORT || 10000;

// Отдаём статику из папки "smart" (например, index.html)
app.use(express.static(path.join(process.cwd(), 'smart')));

// Главный маршрут для отдачи index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'smart', 'index.html'));
});

// Перенаправляем запросы на перевод в translatorRouter
app.use('/translate', translatorRouter);  // Теперь логично

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
