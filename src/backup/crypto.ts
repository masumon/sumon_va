// Optional passphrase encryption for backup archives. Pure-JS (aes-js + js-sha256) so it
// works without a native module. AES-256-CBC with PKCS7 padding; key derived with
// PBKDF2-HMAC-SHA256 (150k iterations). Not a substitute for full-disk encryption, but it
// means an exported/shared backup file is unreadable without the passphrase.
import aesjs from 'aes-js';
import { sha256 } from 'js-sha256';
import * as Crypto from 'expo-crypto';

// "OMENC3" — v3 appends an HMAC over everything before it. v2 is still readable, because
// a backup format that stops accepting the files it wrote is how people lose everything.
const MAGIC = [0x4f, 0x4d, 0x45, 0x4e, 0x43, 0x33];
const MAGIC_V2 = [0x4f, 0x4d, 0x45, 0x4e, 0x43, 0x32];
const MAC_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 16;
const KEY_LEN = 32;
const DERIVED_LEN = KEY_LEN + MAC_LEN;
const ITER_LEN = 4;
const DEFAULT_ITERATIONS = 150_000;

export function isEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.length <= MAGIC.length) return false;
  return MAGIC.every((b, i) => bytes[i] === b) || MAGIC_V2.every((b, i) => bytes[i] === b);
}

/**
 * Salt and IV, from a source that is actually unpredictable.
 *
 * This used to fall back to `Math.random()` when `crypto.getRandomValues` was missing —
 * and it was always missing. Hermes does not implement Web Crypto, and nothing in the
 * dependency tree polyfilled it, so every "encrypted" backup ever written got its salt and
 * its CBC IV from a non-cryptographic PRNG. A predictable IV in front of a known archive
 * header leaks the first block; a predictable salt means one precomputation breaks every
 * backup at once. The tests never caught it because Node has real crypto.
 *
 * `expo-crypto` is asked directly rather than through a global, so there is no runtime in
 * which this quietly degrades. If the platform cannot produce secure randomness the backup
 * does not get written — refusing is the only honest answer, because the alternative is
 * handing someone a file that says "encrypted" and is not.
 */
function randomBytes(length: number): Uint8Array {
  const out = Crypto.getRandomValues(new Uint8Array(length));
  if (!(out instanceof Uint8Array) || out.length !== length) {
    throw new Error('Secure random bytes are unavailable — refusing to encrypt with a weak key');
  }
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const hmac = sha256.hmac as unknown as { array: (k: unknown, m: unknown) => number[] };
  return new Uint8Array(hmac.array(Array.from(key), Array.from(message)));
}

// Every 500 inner iterations, PBKDF2 hands control back to the event loop for a tick
// before resuming. 150,000 pure-JS HMAC-SHA256 rounds (and even the app lock's lighter
// 20,000) ran as one synchronous loop — the JS thread is the only thread React Native has
// for touches, renders and everything else, so that loop froze the whole app for however
// long it took, with no spinner able to paint and no keypress able to register until it
// finished. Yielding costs a handful of event-loop turns; not yielding costs a frozen app
// on every unlock attempt and every encrypted backup.
const YIELD_EVERY_ITERATIONS = 500;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Exported so the app lock derives its PIN key the same way, rather than inventing a second one. */
export async function pbkdf2(passphrase: string, salt: Uint8Array, iterations: number, keyLen: number): Promise<Uint8Array> {
  const pass = new Uint8Array(aesjs.utils.utf8.toBytes(passphrase));
  const blocks = Math.ceil(keyLen / 32);
  const derived = new Uint8Array(blocks * 32);
  for (let block = 1; block <= blocks; block += 1) {
    const blockIndex = new Uint8Array([(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff]);
    const saltBlock = new Uint8Array(salt.length + 4);
    saltBlock.set(salt, 0);
    saltBlock.set(blockIndex, salt.length);
    let u = hmacSha256(pass, saltBlock);
    const t = u.slice();
    for (let i = 1; i < iterations; i += 1) {
      u = hmacSha256(pass, u);
      for (let j = 0; j < t.length; j += 1) t[j] = (t[j] ?? 0) ^ (u[j] ?? 0);
      if (i % YIELD_EVERY_ITERATIONS === 0) await yieldToEventLoop();
    }
    derived.set(t, (block - 1) * 32);
  }
  return derived.slice(0, keyLen);
}

/** Equal-length comparison that does not stop early, so a wrong tag leaks no position. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function encryptArchive(plaintext: Uint8Array, passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<Uint8Array> {
  if (!passphrase) throw new Error('A password is needed to lock the backup');
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const derived = await pbkdf2(passphrase, salt, iterations, DERIVED_LEN);
  const key = derived.slice(0, KEY_LEN);
  const macKey = derived.slice(KEY_LEN);
  const padded = aesjs.padding.pkcs7.pad(plaintext);
  const cbc = new aesjs.ModeOfOperation.cbc(key, iv);
  const ciphertext = cbc.encrypt(padded);
  const iterBytes = new Uint8Array([(iterations >>> 24) & 0xff, (iterations >>> 16) & 0xff, (iterations >>> 8) & 0xff, iterations & 0xff]);

  const head = new Uint8Array(MAGIC.length + ITER_LEN + SALT_LEN + IV_LEN + ciphertext.length);
  let o = 0;
  head.set(MAGIC, o); o += MAGIC.length;
  head.set(iterBytes, o); o += ITER_LEN;
  head.set(salt, o); o += SALT_LEN;
  head.set(iv, o); o += IV_LEN;
  head.set(ciphertext, o);

  // Encrypt-then-MAC over the whole header and body. Without it the ciphertext is
  // malleable and the only thing standing between a corrupted file and a half-restored
  // database is whether PKCS7 padding happens to look valid — which it does once in 256.
  const out = new Uint8Array(head.length + MAC_LEN);
  out.set(head, 0);
  out.set(hmacSha256(macKey, head), head.length);
  return out;
}

export async function decryptArchive(payload: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (!isEncryptedArchive(payload)) throw new Error('Not an encrypted Apon backup');
  const authenticated = MAGIC.every((b, i) => payload[i] === b);
  let o = MAGIC.length;
  const iterations = ((payload[o]! << 24) | (payload[o + 1]! << 16) | (payload[o + 2]! << 8) | payload[o + 3]!) >>> 0;
  o += ITER_LEN;
  const salt = payload.slice(o, o + SALT_LEN); o += SALT_LEN;
  const iv = payload.slice(o, o + IV_LEN); o += IV_LEN;
  const ciphertext = authenticated ? payload.slice(o, payload.length - MAC_LEN) : payload.slice(o);
  if (!iterations || iterations > 5_000_000) throw new Error('Wrong password, or the backup is damaged');
  if (authenticated && payload.length < o + MAC_LEN) throw new Error('Wrong password, or the backup is damaged');
  const derived = await pbkdf2(passphrase, salt, iterations, DERIVED_LEN);
  const key = derived.slice(0, KEY_LEN);

  // Check the tag before touching the ciphertext: a file that fails here is not decrypted
  // at all, rather than decrypted into whatever the wrong key produces.
  if (authenticated) {
    const macKey = derived.slice(KEY_LEN);
    const signed = payload.slice(0, payload.length - MAC_LEN);
    const tag = payload.slice(payload.length - MAC_LEN);
    if (!sameBytes(hmacSha256(macKey, signed), tag)) throw new Error('Wrong password, or the backup is damaged');
  }
  const cbc = new aesjs.ModeOfOperation.cbc(key, iv);
  let padded: Uint8Array;
  try { padded = cbc.decrypt(ciphertext); } catch { throw new Error('Wrong password, or the backup is damaged'); }
  try { return aesjs.padding.pkcs7.strip(padded); } catch { throw new Error('Wrong password, or the backup is damaged'); }
}
