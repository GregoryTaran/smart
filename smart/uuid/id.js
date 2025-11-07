// uuid/id.js
// Small URL-safe random ID (NanoID-like), default length = 21.
// Uses Web Crypto for randomness. ES module.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
const MASK = (1 << 6) - 1; // 63, since alphabet length is 64

export function rid(len = 21) {
  // Generate len characters from ALPHABET
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] & MASK];
  }
  return out;
}
