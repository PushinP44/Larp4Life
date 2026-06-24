/**
 * integrity.js — synchronous SHA-256 + HMAC-SHA-256 for save tamper-detection.
 *
 * Security control for PENTEST F5 (save integrity). save() stays SYNCHRONOUS
 * (it's the last line of every mutator), so we cannot use the async
 * crypto.subtle API — hence a compact, self-contained synchronous SHA-256.
 *
 * HONESTY / LIMITATION: the signing key ships inside this client bundle, so a
 * determined attacker can read it and forge a valid MAC. This therefore DETECTS
 * casual tampering (hand-editing localStorage in DevTools) and corruption — it
 * is NOT cryptographic anti-cheat. Real score integrity requires server-side
 * validation of a replayed seed+action log. See security/PENTEST-REPORT.md F5.
 *
 * Exports:
 *   sha256(str)               → hex string
 *   hmacSha256(key, msg)      → hex string
 *   signPayload(payloadStr)   → hex MAC over payload (module key)
 *   verifyPayload(str, mac)   → boolean (constant-time compare)
 */

const _enc = new TextEncoder();

const _K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const _rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** sha256Bytes(Uint8Array) → Uint8Array(32) */
function sha256Bytes(bytes) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const withOne = l + 1;
  const pad = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + pad + 8;
  const m = new Uint8Array(total);
  m.set(bytes, 0);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, bitLen >>> 0, false);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _K[i] + w[i]) >>> 0;
      const S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
  return out;
}

const _toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

export function sha256(str) {
  return _toHex(sha256Bytes(_enc.encode(String(str))));
}

export function hmacSha256(key, msg) {
  const BLOCK = 64;
  let kb = _enc.encode(String(key));
  if (kb.length > BLOCK) kb = sha256Bytes(kb);
  const k = new Uint8Array(BLOCK);
  k.set(kb);
  const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const mb = _enc.encode(String(msg));
  const inner = new Uint8Array(BLOCK + mb.length);
  inner.set(ipad, 0); inner.set(mb, BLOCK);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(BLOCK + 32);
  outer.set(opad, 0); outer.set(innerHash, BLOCK);
  return _toHex(sha256Bytes(outer));
}

// Detection-grade module key. Origin-bound so a save can't be lifted to another
// origin. NOT secret (ships in client) — see file header.
const _SAVE_KEY = 'ecox-save-integrity-v1:' +
  (typeof location !== 'undefined' && location.origin ? location.origin : 'offline');

export function signPayload(payloadStr) {
  return hmacSha256(_SAVE_KEY, payloadStr);
}

/** Constant-time-ish compare to avoid timing leaks on the MAC check. */
export function verifyPayload(payloadStr, mac) {
  const expected = signPayload(payloadStr);
  if (typeof mac !== 'string' || mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0;
}
