// smart/translator/config.js
// Config for the Translator module (client-side).
// Module can import it dynamically:
//   const cfg = (await import('/translator/config.js?v=' + APP.VERSION)).default;

export default {
  MODULE_NAME: "translator",

  // Server endpoint for translator module (server will mount router at /translate)
  TRANSLATE_ENDPOINT: "/translate/",

  // Default language behavior
  DEFAULT_SOURCE_LANG: "auto",
  DEFAULT_TARGET_LANG: "en",

  // UI prefs for translator module (client-side)
  MAX_TEXT_LENGTH: 10000,
  SHOW_SOURCE_LANG_HINT: true,

  // Rate-limiting on the client to avoid accidental floods (ms)
  MIN_REQUEST_DELAY_MS: 400,

  // Debug
  DEBUG: false
};
