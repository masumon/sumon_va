// Money for the Personal Debt & Receivable module.
//
// Every amount in this module is an INTEGER number of paisa (1 taka = 100 paisa).
// Nothing here ever produces or consumes a floating-point taka value in storage or
// arithmetic — that is the whole point of the file (spec §87: "floating-point error
// এড়াতে হবে"). Display formatting is Bangladesh-style (lakh / crore grouping, §91).

export const PAISA_PER_TAKA = 100;

/** A branded-ish alias so call sites read clearly. It is still just a safe integer. */
export type Paisa = number;

export function isValidPaisa(value: unknown): value is Paisa {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Parse a user-typed amount ("1,50,000.50", "১২৩৪.৫", "2k" is NOT supported) to paisa. */
export function parseTakaToPaisa(input: string | number): Paisa {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Amount must be a finite number');
    return Math.round(input * PAISA_PER_TAKA);
  }
  const normalised = bengaliDigitsToAscii(String(input))
    .replace(/[,\s৳]/gu, '')
    .trim();
  if (normalised === '' || normalised === '.' || normalised === '-') return 0;
  if (!/^-?\d*(?:\.\d*)?$/u.test(normalised)) throw new Error(`Not a valid amount: ${input}`);
  const negative = normalised.startsWith('-');
  const [wholeRaw, fracRaw = ''] = normalised.replace(/^-/u, '').split('.');
  const whole = wholeRaw === '' ? 0 : Number(wholeRaw);
  // Two-decimal precision; a longer fraction is rounded to the nearest paisa.
  const fracPadded = `${fracRaw}00`.slice(0, 2);
  const extraDigit = fracRaw.length > 2 ? Number(fracRaw[2]) : 0;
  let paisa = whole * PAISA_PER_TAKA + Number(fracPadded);
  if (extraDigit >= 5) paisa += 1;
  if (!Number.isSafeInteger(paisa)) throw new Error('Amount is too large');
  return negative ? -paisa : paisa;
}

/** paisa → a plain "1234.50" style string (no grouping, no symbol) — for inputs / export. */
export function paisaToTakaString(paisa: Paisa): string {
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.trunc(abs / PAISA_PER_TAKA);
  const frac = abs % PAISA_PER_TAKA;
  const body = frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** paisa → a display string with Bangladesh grouping, e.g. "৳ 1,50,000" / "৳ 12,34,567.50". */
export function formatPaisa(
  paisa: Paisa,
  opts: { symbol?: boolean; decimals?: 'auto' | 'always' | 'never'; bnDigits?: boolean } = {},
): string {
  const { symbol = true, decimals = 'auto', bnDigits = false } = opts;
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.trunc(abs / PAISA_PER_TAKA);
  const frac = abs % PAISA_PER_TAKA;
  let out = groupBangladesh(whole);
  const showFrac = decimals === 'always' || (decimals === 'auto' && frac !== 0);
  if (showFrac) out += `.${String(frac).padStart(2, '0')}`;
  if (bnDigits) out = asciiDigitsToBengali(out);
  return `${negative ? '-' : ''}${symbol ? '৳ ' : ''}${out}`;
}

/** Indian/Bangladesh digit grouping: last 3 digits, then pairs (12,34,567). */
export function groupBangladesh(whole: number): string {
  const s = String(Math.abs(Math.trunc(whole)));
  if (s.length <= 3) return s;
  const head = s.slice(0, s.length - 3);
  const tail = s.slice(s.length - 3);
  const grouped = head.replace(/\B(?=(\d{2})+(?!\d))/gu, ',');
  return `${grouped},${tail}`;
}

// ── exact integer arithmetic helpers ────────────────────────────────────────────

export function addPaisa(...values: Paisa[]): Paisa {
  return values.reduce((sum, v) => sum + v, 0);
}

export function subPaisa(a: Paisa, b: Paisa): Paisa {
  return a - b;
}

/** Multiply a paisa amount by a plain ratio, rounding half-up to the nearest paisa. */
export function mulPaisa(paisa: Paisa, factor: number): Paisa {
  return Math.round(paisa * factor);
}

/** paisa × (rateBps / 10000), half-up. 1% = 100 bps. */
export function applyBps(paisa: Paisa, rateBps: number): Paisa {
  return Math.round((paisa * rateBps) / 10_000);
}

/** `part` as a percentage of `whole`, to `dp` decimal places (0 when whole is 0). */
export function percentOf(part: Paisa, whole: Paisa, dp = 2): number {
  if (whole === 0) return 0;
  const factor = 10 ** dp;
  return Math.round((part / whole) * 100 * factor) / factor;
}

/** Clamp a remaining balance so ordinary payments can never drive it below zero. */
export function clampNonNegative(paisa: Paisa): Paisa {
  return paisa < 0 ? 0 : paisa;
}

/**
 * Split `total` paisa into `count` parts as evenly as possible with NO rounding drift:
 * every part is `floor(total/count)` and the first `total % count` parts get one extra
 * paisa, so the parts always sum back to exactly `total`.
 */
export function splitEven(total: Paisa, count: number): Paisa[] {
  if (count <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / count);
  const remainder = abs - base * count;
  return Array.from({ length: count }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Allocate `amount` across `weights` proportionally, distributing the rounding
 * remainder to the largest-weight buckets first so the result sums to `amount` exactly.
 */
export function allocateByWeights(amount: Paisa, weights: number[]): Paisa[] {
  const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalWeight <= 0) return splitEven(amount, weights.length);
  const raw = weights.map((w) => (Math.max(0, w) / totalWeight) * amount);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = amount - floored.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

// ── digit conversion ───────────────────────────────────────────────────────────

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function asciiDigitsToBengali(input: string): string {
  return input.replace(/\d/gu, (d) => BN_DIGITS[Number(d)]!);
}

export function bengaliDigitsToAscii(input: string): string {
  return input.replace(/[০-৯]/gu, (d) => String(BN_DIGITS.indexOf(d)));
}
