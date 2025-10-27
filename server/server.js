import express from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 10000;  // Устанавливаем порт 10000

// Отдаём статику из папки smart
app.use(express.static(path.join(__dirname, 'smart')));

// Обрабатываем запросы на главную страницу
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'smart', 'index.html'));
});

// Запускаем сервер на порту 10000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
