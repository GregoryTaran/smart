# Mic Indicator (ESM) — Smart Vision

Лёгкий ESM-класс индикатора уровня микрофона. 
Показывает тонкую серую baseline в тишине и тонкие зеркально-симметричные палочки при речи.
Предназначен для встраивания в микросервисы/страницы.

## Что в папке
- `mic-indicator.js` — ESM класс `export default MicIndicator`.
- `mic-indicator.css` — стили с CSS-переменными (уникальный префикс `--svmic-`).
- Этот README — инструкция по интеграции.

## Быстрая интеграция (статичная страница)
1. Положите папку `mic-indicator` рядом с вашей страницей, например:
   `/VoiceRecorder/mic-indicator/`

2. Подключите CSS в `<head>`:
```html
<link rel="stylesheet" href="./mic-indicator/mic-indicator.css">
