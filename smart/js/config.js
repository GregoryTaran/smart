// smart/js/config.js — site config (exports CONFIG and sets window.CONFIG)
export const CONFIG = {
  BASE_URL: "",                 // use site root
  VERSION: "2025-10-28-v1",
  MOUNT_ID: "app",

  // IMPORTANT: menu1.js expects PAGES as an ARRAY of { id, label, module }
  // module paths are relative to site root; because your files are in js/,
  // point them to js/...
  PAGES: [
    { id: "menu",      label: "Menu",       module: "js/menu1.js" },
    { id: "context",   label: "Context",    module: "js/context/context.js" },
    { id: "translate", label: "Translator", module: "js/translator/translator.js" }
  ],

  UI: {
    showDebugInfo: false
  }
};

// Also set global (index.js reads window.CONFIG)
window.CONFIG = CONFIG;
export default CONFIG;
