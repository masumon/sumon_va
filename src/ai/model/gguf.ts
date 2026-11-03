// Minimal GGUF header reader.
//
// GGUF is the container format used by llama.cpp-family runtimes. We only parse the
// header + metadata key/value block (a few hundred KB at most), never the tensor
// data, so this stays cheap even for multi-GB model files. The goal is to tell the
// user, in plain language, what they picked and whether the app can run it.
//
// Layout (little-endian):
//   magic   : "GGUF"            (4 bytes)
//   version : uint32            (2 or 3)
//   n_tensors : uint64
//   n_kv      : uint64
//   then n_kv entries: key(string) + value_type(uint32) + value(typed)
// A GGUF "string" is uint64 length + that many UTF-8 bytes.

export type GgufValue = string | number | bigint | boolean | GgufValue[];

export interface GgufHeader {
  version: number;
  tensorCount: number;
  kvCount: number;
  /** Flattened metadata. Array values are kept as arrays; scalars as-is. */
  metadata: Record<string, GgufValue>;
  /** True when the metadata block did not fit in the bytes we were given. */
  truncated: boolean;
}

const GGUF_MAGIC = 0x46554747; // "GGUF" read as little-endian uint32

// llama.cpp value type ids.
const T_UINT8 = 0, T_INT8 = 1, T_UINT16 = 2, T_INT16 = 3, T_UINT32 = 4, T_INT32 = 5,
  T_FLOAT32 = 6, T_BOOL = 7, T_STRING = 8, T_ARRAY = 9, T_UINT64 = 10, T_INT64 = 11, T_FLOAT64 = 12;

class Cursor {
  offset = 0;
  constructor(readonly view: DataView, readonly bytes: Uint8Array) {}
  get remaining() { return this.view.byteLength - this.offset; }
  need(n: number) { if (this.offset + n > this.view.byteLength) throw new RangeError('gguf: out of bounds'); }
  u8() { this.need(1); return this.view.getUint8(this.offset++); }
  i8() { this.need(1); return this.view.getInt8(this.offset++); }
  u16() { this.need(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  u64() { this.need(8); const v = this.view.getBigUint64(this.offset, true); this.offset += 8; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.offset, true); this.offset += 8; return v; }
  str() {
    const len = Number(this.u64());
    if (len < 0 || len > 1 << 24) throw new RangeError('gguf: implausible string length');
    this.need(len);
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return utf8Decode(slice);
  }
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  try { return decodeURIComponent(escape(out)); } catch { return out; }
}

function readScalar(c: Cursor, type: number): GgufValue {
  switch (type) {
    case T_UINT8: return c.u8();
    case T_INT8: return c.i8();
    case T_UINT16: return c.u16();
    case T_INT16: return c.i16();
    case T_UINT32: return c.u32();
    case T_INT32: return c.i32();
    case T_FLOAT32: return c.f32();
    case T_FLOAT64: return c.f64();
    case T_BOOL: return c.u8() !== 0;
    case T_STRING: return c.str();
    case T_UINT64: { const v = c.u64(); return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    case T_INT64: { const v = c.i64(); const abs = v < 0n ? -v : v; return abs <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    default: throw new RangeError(`gguf: unknown value type ${type}`);
  }
}

function readValue(c: Cursor, type: number): GgufValue {
  if (type !== T_ARRAY) return readScalar(c, type);
  const elemType = c.u32();
  const len = Number(c.u64());
  if (len < 0 || len > 1 << 22) throw new RangeError('gguf: implausible array length');
  const out: GgufValue[] = [];
  // Keep big token vocab arrays from blowing memory — the header summary never needs them.
  const cap = Math.min(len, 64);
  for (let i = 0; i < len; i++) {
    const v = readValue(c, elemType);
    if (i < cap) out.push(v);
  }
  return out;
}

/** Returns null when the bytes are not a GGUF container at all. Throws only on truly corrupt input. */
export function parseGgufHeader(input: ArrayBuffer | Uint8Array): GgufHeader | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GGUF_MAGIC) return null;

  const c = new Cursor(view, bytes);
  c.offset = 4;
  const version = c.u32();
  const tensorCount = Number(c.u64());
  const kvCount = Number(c.u64());
  if (version < 1 || version > 3 || kvCount < 0 || kvCount > 1 << 20) return null;

  const metadata: Record<string, GgufValue> = {};
  let truncated = false;
  for (let i = 0; i < kvCount; i++) {
    try {
      const key = c.str();
      const type = c.u32();
      metadata[key] = readValue(c, type);
    } catch {
      truncated = true;
      break;
    }
  }
  return { version, tensorCount, kvCount, metadata, truncated };
}

// --- Human-friendly summary -------------------------------------------------

export interface GgufSummary {
  architecture: string | null;
  name: string | null;
  quantLabel: string;
  quantIsMobileFriendly: boolean;
  contextLength: number | null;
  parameterCount: number | null;
  version: number;
}

// llama.cpp `llama_ftype` → label. Values Q4_K_M / Q4_0 / Q5_K_M / Q8_0 etc. run
// comfortably on a phone; F16/F32 do not (2–4× the RAM).
const FTYPE: Record<number, { label: string; mobile: boolean }> = {
  0: { label: 'F32 (unquantized)', mobile: false },
  1: { label: 'F16', mobile: false },
  2: { label: 'Q4_0', mobile: true },
  3: { label: 'Q4_1', mobile: true },
  7: { label: 'Q8_0', mobile: true },
  8: { label: 'Q5_0', mobile: true },
  9: { label: 'Q5_1', mobile: true },
  10: { label: 'Q2_K', mobile: true },
  11: { label: 'Q3_K_S', mobile: true },
  12: { label: 'Q3_K_M', mobile: true },
  13: { label: 'Q3_K_L', mobile: true },
  14: { label: 'Q4_K_S', mobile: true },
  15: { label: 'Q4_K_M', mobile: true },
  16: { label: 'Q5_K_S', mobile: true },
  17: { label: 'Q5_K_M', mobile: true },
  18: { label: 'Q6_K', mobile: true },
  19: { label: 'IQ2_XXS', mobile: true },
  20: { label: 'IQ2_XS', mobile: true },
  23: { label: 'IQ3_XXS', mobile: true },
  25: { label: 'IQ1_S', mobile: true },
  29: { label: 'IQ4_NL', mobile: true },
  30: { label: 'IQ4_XS', mobile: true },
};

const SUPPORTED_ARCH = new Set([
  'llama', 'qwen2', 'qwen3', 'gemma', 'gemma2', 'gemma3', 'phi2', 'phi3', 'phi4',
  'stablelm', 'mistral', 'starcoder2', 'gptneox', 'falcon', 'mpt', 'bloom', 'olmo',
  'internlm2', 'command-r', 'minicpm', 'smollm',
]);

function num(v: GgufValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  return null;
}

export function summarizeGguf(header: GgufHeader): GgufSummary {
  const md = header.metadata;
  const architecture = typeof md['general.architecture'] === 'string' ? (md['general.architecture'] as string) : null;
  const name = typeof md['general.name'] === 'string' ? (md['general.name'] as string) : null;
  const ftype = num(md['general.file_type']);
  const q = ftype != null ? FTYPE[ftype] : undefined;
  const contextLength = architecture
    ? num(md[`${architecture}.context_length`])
    : null;
  const parameterCount = num(md['general.parameter_count']);
  return {
    architecture,
    name,
    quantLabel: q?.label ?? (ftype != null ? `type ${ftype}` : 'unknown'),
    quantIsMobileFriendly: q?.mobile ?? false,
    contextLength,
    parameterCount,
    version: header.version,
  };
}

export function isArchitectureSupported(arch: string | null): boolean {
  return arch != null && SUPPORTED_ARCH.has(arch.toLowerCase());
}
