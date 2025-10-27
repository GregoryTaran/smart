import express from 'express';

const app = express();
const PORT = process.env.PORT || 5000;

// Основной файл сервера, минимальная настройка для деплоя

app.use(express.json());

// Временно не используем роутеры, чтобы избежать ошибок при деплое
// app.use('/translate', translationRouter);
// app.use('/session', sessionRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
