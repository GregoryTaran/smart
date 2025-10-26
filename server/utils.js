import fs from 'fs';

// Функция для логирования
export function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync('server.log', logMessage);
  console.log(logMessage);
}
