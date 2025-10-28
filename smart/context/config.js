// smart/context/config.js
// Config for the Context module (client-side).
// Module should import it dynamically, e.g.:
//   const cfg = (await import('/context/config.js?v=' + APP.VERSION)).default;

export default {
  MODULE_NAME: "context",

  // Audio params
  AUDIO_SAMPLE_RATE: 44100,         // prefered sample rate for recorder worklet
  CHANNELS: 1,

  // How often send accumulated chunks (client-side can override)
  CHUNK_SEND_INTERVAL_MS: 2000,

  // Maximum size (bytes) of a single chunk send (safety)
  CHUNK_MAX_BYTES: 30 * 1024 * 1024, // 30 MB

  // Networking: module decides whether to use WS or HTTP
  USE_WEBSOCKET: true,
  WS_PATH: "/context/ws",            // WebSocket path (server module may mount it here)
  HTTP_CHUNK_PATH: "/context/chunk", // HTTP fallback endpoint

  // Merge/processing endpoints (server-side endpoints)
  MERGE_ENDPOINT: "/context/merge",
  WHISPER_ENDPOINT: "/context/whisper",
  GPT_ENDPOINT: "/context/gpt",
  TTS_ENDPOINT: "/context/tts",

  // Client behavior toggles
  AUTO_MERGE_ON_STOP: true,         // call /merge when recording stops
  AUTO_WHISPER_AFTER_MERGE: true,   // call /whisper automatically after merge

  // Debug
  DEBUG: false
};
