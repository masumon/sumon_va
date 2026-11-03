// Bridge to the native GGUF runtime (`llama.rn`).
//
// The require is static and guarded rather than indirected through `eval`. It used to be
// `(0, eval)('require')` so the bundler would not hard-require a package that was usually
// absent — which worked precisely because the package was absent. Now that it ships, that
// trick becomes the bug: Metro only bundles what it can see statically, and a release
// Hermes bundle has no `require` for `eval` to find, so the runtime would have been
// reported missing on the very builds that carry it. The try/catch stays, so a build made
// without the native module still degrades to a clear answer instead of a white screen.

import { recordTiming } from '../../services/assistant-perf';
import { logAppError } from '../../services/error-log';
import { fastLoadOptions, fastLoadWorked, idleReleaseMs, noteLiveSpeed, saveProfile, scaledTokens, threadOptions, tierFor } from './device-profile';
import { armLoadWatchdog, classifyLoadFailure, disarmLoadWatchdog, isSlowGeneration, reportLlmIssue } from './llm-health';

export interface RuntimeProbe {
  available: boolean;
  /** Why it is not available, in plain language, when `available` is false. */
  reason: string;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type CompletionOpts = {
  prompt?: string;
  /** Chat turns, formatted with the model's own template (the GGUF's chat_template). */
  messages?: ChatMessage[];
  jinja?: boolean;
  enable_thinking?: boolean;
  response_format?: { type: 'json_schema'; json_schema: { strict?: boolean; schema: object } } | { type: 'json_object'; schema?: object };
  n_predict?: number;
  temperature?: number;
  stop?: string[];
  /** Image files handed to a vision model alongside the prompt. */
  media_paths?: string[];
};
type LlamaModule = {
  initLlama: (opts: { model: string; n_ctx?: number; n_gpu_layers?: number }) => Promise<LlamaContext>;
};
type LlamaContext = {
  completion: (opts: CompletionOpts) => Promise<{ text: string }>;
  stopCompletion: () => Promise<void>;
  initMultimodal: (opts: { path: string; use_gpu?: boolean; image_max_tokens?: number }) => Promise<boolean>;
  getMultimodalSupport: () => Promise<{ vision: boolean; audio: boolean }>;
  release: () => Promise<void>;
};

let cached: LlamaModule | null | undefined;

function loadModule(): LlamaModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('llama.rn') as LlamaModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** The AI library ships only 64-bit code; a 32-bit-only phone runs the whole app without it. */
export function is64BitPhone(archs?: readonly string[] | null): boolean {
  if (archs === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      archs = (require('expo-device') as { supportedCpuArchitectures?: string[] | null }).supportedCpuArchitectures;
    } catch { archs = null; }
  }
  if (!archs || archs.length === 0) return true; // unknown — let the load itself decide
  return archs.some((a) => /arm64|aarch64|x86[_-]?64/iu.test(a));
}

export function probeRuntime(): RuntimeProbe {
  const mod = loadModule();
  if (!mod || typeof mod.initLlama !== 'function' || !is64BitPhone()) {
    return {
      available: false,
      reason: 'এই ফোনে AI চালানো যায় না — আপন AI ছাড়াই সব কাজ ঠিকঠাক করবে।',
    };
  }
  return { available: true, reason: '' };
}

export interface SmokeResult {
  ok: boolean;
  /** A short sample of generated text on success. */
  sample?: string;
  /** Failure reason on `ok === false`. */
  reason?: string;
  elapsedMs?: number;
}

/**
 * Crash-loop guard. A model too big for the phone does not throw — the OS kills the whole
 * process mid-load, so no JS runs afterwards and a normal catch can never notice. So a
 * marker file is written just before a load and removed once the load (and its first
 * reply) survives. Finding the marker on a later run, with no load in progress here, means
 * the previous attempt took the app down: the on-device engine then reports itself not
 * ready, the Assistant stays on the built-in engine, and the model screen says why.
 * A successful re-verify clears it.
 */
const LOAD_MARKER = 'llm-load-in-progress';
let loadingNow = 0;

type MarkerFile = { exists: boolean; create(o?: { overwrite?: boolean }): void; write(s: string): void; delete(): void; textSync?(): string };
function markerFile(): MarkerFile | null {
  try {
    // Required lazily like `llama.rn` above: this module is also loaded by the web/jest
    // project, where the native file module is not available at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as { File: new (dir: unknown, name: string) => MarkerFile; Paths: { document: unknown } };
    return new File(Paths.document, LOAD_MARKER);
  } catch { return null; }
}

async function guardedLoad<T>(work: () => Promise<T>): Promise<T> {
  loadingNow += 1;
  try {
    const f = markerFile();
    f?.create({ overwrite: true });
    f?.write(new Date().toISOString());
  } catch { /* best-effort — the guard must never block a load */ }
  // A phone notification booked for later and cancelled below — it only reaches the person
  // if Android closes the app mid-load (llm-health.ts). Not awaited: the load never waits
  // on it, and the cancel runs after the booking so a quick load cannot leave it behind.
  const booked = armLoadWatchdog();
  try {
    return await work();
  } finally {
    loadingNow -= 1;
    void booked.then(() => disarmLoadWatchdog());
    // Reached for a normal success or a normal JS failure alike; only a killed process
    // leaves the marker behind.
    try { const f = markerFile(); if (f?.exists) f.delete(); } catch { /* noop */ }
  }
}

/** When that unfinished load began — so a notice about it can be put away once, for that one. */
export function unfinishedLoadAt(): string | null {
  if (!lastLoadDidNotFinish()) return null;
  try { return markerFile()?.textSync?.() ?? 'unknown'; } catch { return 'unknown'; }
}

/** True when the last model load never finished because the app was killed during it. */
export function lastLoadDidNotFinish(): boolean {
  if (loadingNow > 0) return false;
  try { return Boolean(markerFile()?.exists); } catch { return false; }
}

/** Load the model, generate a few tokens, release. Used by the "Verify" flow. */
export async function smokeTest(modelPath: string, contextLength: number | null): Promise<SmokeResult> {
  return guardedLoad(() => smokeTestUnguarded(modelPath, contextLength));
}

async function smokeTestUnguarded(modelPath: string, contextLength: number | null): Promise<SmokeResult> {
  const mod = loadModule();
  if (!mod) return { ok: false, reason: probeRuntime().reason };
  const started = Date.now();
  let ctx: LlamaContext | undefined;
  try {
    ctx = await mod.initLlama({
      model: modelPath,
      n_ctx: Math.min(contextLength ?? 2048, 2048),
      n_gpu_layers: 0,
    });
    const out = await ctx.completion({
      prompt: 'Reply with the single word: ready',
      n_predict: 8,
      temperature: 0,
      stop: ['\n'],
    });
    const sample = (out.text ?? '').trim();
    if (!sample) return { ok: false, reason: 'মডেল লোড হয়েছে কিন্তু কোনো টেক্সট তৈরি করেনি।', elapsedMs: Date.now() - started };
    return { ok: true, sample, elapsedMs: Date.now() - started };
  } catch (e) {
    // The raw text goes to the error list; the person gets a sentence they can act on.
    const reason = 'মডেলটি এই ফোনে চালানো গেল না — অন্য বা আরও ছোট মডেল বেছে দেখুন।';
    logAppError('ai:smoke-test', e, reason);
    return { ok: false, reason, elapsedMs: Date.now() - started };
  } finally {
    try { await ctx?.release(); } catch { /* noop */ }
  }
}

let liveCtx: { path: string; ctx: LlamaContext } | null = null;

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  /** Abort: the caller stops waiting at once, and the native reply is told to stop. */
  signal?: AbortSignal;
  /**
   * Send as a chat (system + user) in the model's own template instead of a raw prompt.
   * Instruction-tuned models (Qwen, Llama, Gemma) were trained on that template; a raw
   * prompt is what made their answers short, cut off or unrelated on the phone.
   */
  chat?: { system: string };
  /** Constrain the reply to this JSON schema (grammar-enforced by the runtime). */
  jsonSchema?: object;
}

const HARD_TOKEN_CAP = 512;

/**
 * A loaded model is a multi-gigabyte native allocation, and leaving it resident is what
 * starved SQLite of memory until data silently stopped loading (NF-06). One screen's
 * unmount was never enough of a trigger: the Assistant's own back button and result links
 * `router.push` on top of it, so the screen stays mounted underneath and the model stayed
 * pinned for the rest of the session. So the model is now let go on three occasions, and
 * the two below are the ones that need no screen to remember them.
 */
// How long the model stays ready depends on the phone's memory (device-profile.ts).
const idleMs = (): number => idleReleaseMs(phoneRam());
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove(): void } | null = null;

function cancelIdleRelease(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/** Nothing has asked the model for anything in a while — give the memory back. */
function scheduleIdleRelease(): void {
  cancelIdleRelease();
  idleTimer = setTimeout(() => { void releaseLlama(); }, idleMs());
}

/**
 * Backgrounding the app does not unmount anything, so without this the model stays in RAM
 * while the user is in another app entirely -- exactly when the phone is most likely to
 * need that memory back. Registered once, on the first load, and left in place: the
 * listener is cheap and re-registering per load would leak subscriptions.
 */
function releaseWhenBackgrounded(): void {
  if (appStateSub) return;
  try {
    // Required here rather than imported at the top for the same reason `llama.rn` is:
    // this module is also loaded by the web/jest project, where `react-native` resolves to
    // a build that does not carry every native export. The idle release above still holds
    // if this is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native') as {
      AppState: { addEventListener: (event: string, handler: (state: string) => void) => { remove(): void } };
    };
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void releaseLlama();
    });
  } catch { /* no AppState here — idle release is the remaining guard */ }
}

/** Free the warm context and its memory. Safe to call when nothing is loaded. */
export async function releaseLlama(): Promise<void> {
  cancelIdleRelease();
  const current = liveCtx;
  liveCtx = null;
  try { await current?.ctx.release(); } catch { /* noop */ }
}

/**
 * One request at a time. Two questions arriving while nothing was loaded both loaded the
 * multi-GB model (one copy leaked), and a second reply started while the first was still
 * being written was refused natively ("Context is busy"). Each waits for the one before it
 * to finish — including a stopped one — and one aborted while waiting never runs at all.
 */
let lane: Promise<unknown> = Promise.resolve();
let inLane = 0;

/** Free-form generation for the pluggable AiEngine. Keeps one context warm per model. */
export async function generateWith(
  modelPath: string,
  contextLength: number | null,
  prompt: string,
  options: GenerateOptions | number = {},
): Promise<string> {
  const signal = typeof options === 'number' ? undefined : options.signal;
  const runTurn = async (): Promise<string> => {
    if (signal?.aborted) throw new Error('aborted');
    // Only a fresh load can take the process down; a reply from a model already in memory
    // needs no guard. Decided on its turn: the request before may have just loaded it.
    const freshLoad = !liveCtx || liveCtx.path !== modelPath;
    return freshLoad
      ? guardedLoad(() => generateWithUnguarded(modelPath, contextLength, prompt, options))
      : generateWithUnguarded(modelPath, contextLength, prompt, options);
  };
  // Nothing ahead: start now (the crash marker is on disk before this returns).
  const turn = inLane === 0 ? runTurn() : lane.then(runTurn);
  inLane += 1;
  lane = turn.catch(() => undefined).then(() => { inLane -= 1; });
  return signal ? untilAborted(turn, signal) : turn;
}

/** The caller stops waiting the moment it aborts; the lane still waits for the native side. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { work.catch(() => undefined); return Promise.reject(new Error('aborted')); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function generateWithUnguarded(
  modelPath: string,
  contextLength: number | null,
  prompt: string,
  options: GenerateOptions | number,
): Promise<string> {
  const opts: GenerateOptions = typeof options === 'number' ? { maxTokens: options } : options;
  const mod = loadModule();
  if (!mod) throw new Error(probeRuntime().reason);
  cancelIdleRelease();
  if (!liveCtx || liveCtx.path !== modelPath) {
    try { await liveCtx?.ctx.release(); } catch { /* noop */ }
    releaseWhenBackgrounded();
    const loadStarted = Date.now();
    let loaded: Awaited<ReturnType<typeof mod.initLlama>>;
    // Sized to the phone (GGUF plan #12): a smaller working memory on a phone with less RAM.
    const nCtx = contextForPhone(contextLength);
    try {
      // The measured threads, and the faster memory options unless this phone has shown it
      // cannot take them (tried once, crash-safe — device-profile.ts). A plain load follows
      // if the faster one is refused.
      const fast = fastLoadOptions();
      try {
        loaded = await mod.initLlama({ model: modelPath, n_ctx: nCtx, n_gpu_layers: 0, ...threadOptions(), ...fast } as Parameters<typeof mod.initLlama>[0]);
        if (Object.keys(fast).length) fastLoadWorked(true);
      } catch (first) {
        const why = classifyLoadFailure(first);
        if (!Object.keys(fast).length || why === 'MODEL_MISSING') throw first;
        // Short of memory is not the faster options' fault: try them again another time.
        if (why === 'LOW_MEMORY') { saveProfile({ fastOptions: 'untested' }); throw first; }
        fastLoadWorked(false);
        loaded = await mod.initLlama({ model: modelPath, n_ctx: nCtx, n_gpu_layers: 0, ...threadOptions() } as Parameters<typeof mod.initLlama>[0]);
      }
    } catch (e) {
      const kind = classifyLoadFailure(e);
      // Short of memory: one quiet retry with half the working memory before giving up, so the
      // answer can still come; only if that fails too is the person told (llm-health.ts).
      const retry = kind === 'LOW_MEMORY' && nCtx > 1024
        ? await mod.initLlama({ model: modelPath, n_ctx: Math.max(1024, Math.floor(nCtx / 2)), n_gpu_layers: 0 }).catch(() => null)
        : null;
      if (!retry) {
        if (kind) reportLlmIssue(kind);
        throw e;
      }
      loaded = retry;
    }
    liveCtx = { path: modelPath, ctx: loaded };
    recordTiming('llm-load', Date.now() - loadStarted);
  }
  // Shorter on a slow or hot phone, full on a fast one (device-profile.ts).
  const n_predict = Math.max(1, Math.min(scaledTokens(opts.maxTokens ?? 256), HARD_TOKEN_CAP));
  const base = { n_predict, temperature: opts.temperature ?? 0.3, stop: opts.stop };
  const ctx = liveCtx.ctx;
  const signal = opts.signal;
  // On abort the native reply is told to stop — only ceasing to wait left it writing, and the
  // busy context refused the next question. Waited for here, so the lane is free after it.
  const stop = () => { try { void ctx.stopCompletion().catch(() => {}); } catch { /* noop */ } };
  try {
    // Aborted while the model was loading: it stays warm, but no reply is started.
    if (signal?.aborted) throw new Error('aborted');
    signal?.addEventListener('abort', stop, { once: true });
    const run = opts.chat
      ? ctx.completion({
          ...base,
          messages: [{ role: 'system', content: opts.chat.system }, { role: 'user', content: prompt }],
          jinja: true,
          enable_thinking: false,
          ...(opts.jsonSchema ? { response_format: { type: 'json_schema' as const, json_schema: { strict: true, schema: opts.jsonSchema } } } : {}),
        }).catch((e: unknown) => {
          if (signal?.aborted) throw e;
          // A model whose file carries no usable template: the old plain layout still works.
          return ctx.completion({ ...base, prompt: `${opts.chat!.system}

### Instruction:
${prompt}

### Response:
` });
        })
      : ctx.completion({ ...base, prompt });
    const out = await run;
    if (signal?.aborted) throw new Error('aborted');
    // llama.rn reports how fast the words came; very slow is worth telling the person.
    const timings = (out as { timings?: { predicted_n?: number; predicted_per_second?: number } }).timings;
    if (isSlowGeneration(timings)) reportLlmIssue('SLOW');
    noteLiveSpeed(timings?.predicted_per_second);
    return (out.text ?? '').trim();
  } finally {
    signal?.removeEventListener('abort', stop);
    // Including after an abort: the caller stopped waiting, but the memory is still held.
    scheduleIdleRelease();
  }
}

/**
 * Read the text in a picture, using the installed model's own eyes.
 *
 * There is no Tesseract here and there is not going to be: the only React Native binding
 * for it has been unmaintained since 2022 and still declares React 16, and every OCR
 * package that *is* maintained on Android wraps Google's ML Kit, which recognises Latin,
 * Chinese, Devanagari, Japanese and Korean — and not Bengali. For a Bengali-first app that
 * rules the whole category out.
 *
 * A vision model reads the page instead of matching glyph shapes against a font, which is
 * both why it can handle Bengali at all and why it has any chance on handwriting. It needs
 * two files rather than one — the model and its `mmproj` projector — which is why the model
 * manager asks for the second separately and treats it as optional: a text-only model is
 * still perfectly good for everything else the assistant does.
 *
 * The context is not kept warm. A vision context holds the encoded image as well as the
 * model, and photographs arrive one at a time minutes apart, so holding that memory between
 * two prescriptions costs far more than reloading for the second one.
 */
export interface ReadImageResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

export async function readImageText(
  modelPath: string,
  mmprojPath: string,
  imagePath: string,
  contextLength: number | null,
  prompt: string,
): Promise<ReadImageResult> {
  return guardedLoad(() => readImageTextUnguarded(modelPath, mmprojPath, imagePath, contextLength, prompt));
}

async function readImageTextUnguarded(
  modelPath: string,
  mmprojPath: string,
  imagePath: string,
  contextLength: number | null,
  prompt: string,
): Promise<ReadImageResult> {
  const mod = loadModule();
  if (!mod) return { ok: false, reason: probeRuntime().reason };
  let ctx: LlamaContext | undefined;
  try {
    ctx = await mod.initLlama({
      model: modelPath,
      // Room for the image tokens as well as the answer; a page of text is not cheap.
      n_ctx: Math.min(contextLength ?? 4096, 4096),
      n_gpu_layers: 0,
    });
    const enabled = await ctx.initMultimodal({ path: mmprojPath, use_gpu: false, image_max_tokens: 1024 });
    if (!enabled) return { ok: false, reason: 'ছবি পড়ার অংশটি (mmproj) এই মডেলের সাথে চালু করা গেল না।' };
    const support = await ctx.getMultimodalSupport();
    if (!support.vision) return { ok: false, reason: 'এই মডেলটি ছবি দেখতে পারে না — ভিশন মডেল লাগবে।' };
    const out = await ctx.completion({
      prompt,
      media_paths: [imagePath],
      n_predict: 512,
      temperature: 0,
    });
    const text = (out.text ?? '').trim();
    if (!text) return { ok: false, reason: 'ছবিতে কোনো লেখা পাওয়া যায়নি।' };
    return { ok: true, text };
  } catch (e) {
    const reason = 'ছবি থেকে লেখা তোলা গেল না।';
    logAppError('ai:read-image', e, reason);
    return { ok: false, reason };
  } finally {
    try { await ctx?.release(); } catch { /* noop */ }
  }
}

/**
 * How much working memory (context) to give the model on this phone (GGUF plan #12).
 * The model file sets the ceiling; the phone's RAM sets what is sensible: 4096 on a phone
 * with more than 6 GB, otherwise 2048. Unknown RAM keeps 2048.
 */
export function contextForPhone(modelContext: number | null, totalRamBytes: number | null = phoneRam()): number {
  const ceiling = Math.min(modelContext ?? 4096, 4096);
  const gb = totalRamBytes ? totalRamBytes / 1024 ** 3 : null;
  // Never below 2048 at first: a Bangla instruction plus the question needs the room (phones
  // under 4 GB are already turned away by the model check). 1024 is only the low-memory retry.
  const byPhone = gb !== null && gb > 6 ? 4096 : 2048;
  return Math.max(512, Math.min(ceiling, byPhone));
}

function phoneRam(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device') as { totalMemory?: number | null };
    return Device.totalMemory ?? null;
  } catch { return null; }
}

/**
 * Measure this phone once, during "যাচাই" (device-profile.ts): the model writes a few words
 * with 4 and with 6 threads; the faster is kept with its speed and tier. A small context, so
 * it costs little memory; guarded like every load, so a phone that cannot take it is known.
 */
export async function calibrateSpeed(modelPath: string): Promise<{ threads: number; tokensPerSecond: number } | null> {
  return guardedLoad(async () => {
    const mod = loadModule();
    if (!mod) return null;
    let best: { threads: number; tokensPerSecond: number } | null = null;
    for (const threads of [4, 6]) {
      let ctx: LlamaContext | undefined;
      try {
        ctx = await mod.initLlama({ model: modelPath, n_ctx: 512, n_gpu_layers: 0, n_threads: threads } as Parameters<typeof mod.initLlama>[0]);
        const out = await ctx.completion({ prompt: 'Count from one to twenty in words:', n_predict: 24, temperature: 0 });
        const tps = (out as { timings?: { predicted_per_second?: number } }).timings?.predicted_per_second ?? 0;
        if (tps > 0 && (!best || tps > best.tokensPerSecond)) best = { threads, tokensPerSecond: tps };
      } catch { /* this setting did not run here — the other may */ }
      finally { try { await ctx?.release(); } catch { /* noop */ } }
    }
    if (best) saveProfile({ threads: best.threads, tokensPerSecond: best.tokensPerSecond, tier: tierFor(best.tokensPerSecond), at: new Date().toISOString() });
    return best;
  });
}
