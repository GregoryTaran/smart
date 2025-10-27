// Настройка WebSocket-соединения
const socket = new WebSocket('ws://localhost:10000');  // Подключаемся к серверу

// Обработчик для получения данных с AudioWorkletProcessor
worklet.port.onmessage = (e) => {
  const chunk = e.data;  // Данные из AudioWorkletProcessor

  // Проверяем, открыт ли WebSocket, и отправляем данные
  if (socket.readyState === WebSocket.OPEN) {
    // Проверяем, что chunk является Uint8Array, Float32Array или подобным
    if (chunk instanceof Float32Array) {
      socket.send(chunk.buffer);  // Отправляем как ArrayBuffer
    } else {
      console.error('Неожиданный формат данных:', chunk);
    }
  }
};
