// server/setup-dirs.js
const fs = require('fs');
const path = require('path');

const BASE = process.cwd();
const DATA_DIR = path.join(BASE, 'voicerecorder_data');
const TMP = path.join(DATA_DIR, 'tmp');
const FINAL = path.join(DATA_DIR, 'final');

[DATA_DIR, TMP, FINAL].forEach(dir=>{
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log('[setup-dirs] created', dir);
    } catch (e) {
      console.error('[setup-dirs] failed to create', dir, e && e.message);
    }
  } else {
    // console.log('[setup-dirs] exists', dir);
  }
});
