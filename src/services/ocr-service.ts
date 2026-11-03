// Reading the text in a photograph — a prescription, a receipt, a medicine box.
//
// Two readers, and which one runs is decided by what the phone actually has, not by what
// would be nicest. That ordering is the whole design:
//
//   ML Kit  — built into the app, nothing to download, works on every phone from the first
//             launch. It reads Latin script, which on a Bangladeshi prescription is most of
//             what matters: the drug names, "500mg", "1+0+1", the dates. It cannot read
//             Bengali script at all — Google's text recogniser covers Latin, Chinese,
//             Devanagari, Japanese and Korean, and Bengali is not among them.
//
//   Vision model — only for someone who has added a multimodal GGUF and its projector. It
//             reads the page rather than matching glyphs against a font, so it handles
//             Bengali, and it has some chance on handwriting where nothing else does.
//
// The model is preferred when it is there and ML Kit carries everyone else, so the feature
// is never gated behind a multi-gigabyte download. Tesseract is not an option and is not
// coming: its only React Native binding has been unmaintained since 2022 and still declares
// React 16 as a peer.

import type { SQLiteDatabase } from 'expo-sqlite';
import { analyzeImage, isSupported } from 'react-native-image-analysis';
import { File } from 'expo-file-system';
import { stagePhoto } from './attachment-service';
import { cleanOcrText, looksLikeGarbage, looksLikeMissedBengali, rowsFromLines } from './ocr-clean';
import { loadInstalledModel } from '../ai/model/model-manager';
import { lastLoadDidNotFinish, probeRuntime, readImageText } from '../ai/model/llama-runtime';

export type OcrReader = 'vision-model' | 'mlkit';

export interface OcrResult {
  ok: boolean;
  text?: string;
  /** Which reader produced the text, so the screen can say so honestly. */
  reader?: OcrReader;
  /** A caveat about a result that did come back (e.g. Bengali skipped). */
  note?: string;
  /** Why nothing came back, in plain language, when `ok` is false. */
  reason?: string;
}

/**
 * What the vision model is asked for.
 *
 * Plain transcription, not interpretation. Whatever comes out goes straight into the
 * assistant's existing NLP pipeline, which already knows how to turn a sentence into a
 * task, a memory or an expense — so a model that helpfully summarised the page instead of
 * transcribing it would throw away exactly the details that pipeline reads.
 */
const TRANSCRIBE_PROMPT =
  'Transcribe every piece of text visible in this image exactly as written, preserving line breaks. '
  + 'Include Bengali and English text. Do not translate, summarise, or explain. Output only the text.';

export function describeReader(reader: OcrReader, bn: boolean): string {
  if (reader === 'vision-model') return bn ? 'আপনার নিজের AI মডেল' : 'your own AI model';
  return bn ? 'অ্যাপের বিল্ট-ইন রিডার' : 'the built-in reader';
}

/** True when this build can read any image at all — used to hide the entry point otherwise. */
export function canReadImages(): boolean {
  try { return isSupported().textRecognition; } catch { return false; }
}

export async function readTextFromImage(db: SQLiteDatabase, imageUri: string, bn = true): Promise<OcrResult> {
  const model = await loadInstalledModel(db).catch(() => null);
  if (model?.mmprojPath && model.verifiedAt && probeRuntime().available && !lastLoadDidNotFinish()) {
    const viaModel = await readImageText(model.path, model.mmprojPath, imageUri, model.summary.contextLength, TRANSCRIBE_PROMPT);
    if (viaModel.ok && viaModel.text) return { ok: true, text: viaModel.text, reader: 'vision-model' };
    // A model that failed on this particular page is not a reason to give up on the page;
    // the built-in reader below may still get the printed half of it.
  }

  if (!canReadImages()) {
    return { ok: false, reason: bn ? 'এই ফোনে ছবি থেকে লেখা তোলা যাচ্ছে না।' : 'This phone cannot read text from images.' };
  }

  try {
    // Text only: barcode detection is on by default and costs a whole extra pass for
    // something no caller here reads.
    // Line by line keeps the page's own line breaks; the tidy-up fixes ML Kit's usual
    // look-alike mistakes in numbers and doses (ocr-clean.ts).
    const result = await analyzeImage({ uri: imageUri }, { types: ['text'], text: { detail: 'lines' } });
    const placed = (result.blocks ?? []).flatMap((b) => b.lines);
    const level = placed.length > 1 && placed.every((l) => Math.abs(l.angle ?? 0) < 8);
    const text = cleanOcrText(level ? rowsFromLines(placed) : result.transcript);
    // A Bengali page read by the English-only reader comes back as scraps, not words (RC.4
    // QA T64). Saying so honestly beats handing the user a page of nonsense to save.
    const scores = placed.map((l) => l.confidence).filter((c): c is number => typeof c === 'number');
    const confidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
    if (!result.hasText || !text || looksLikeGarbage(text, confidence)) {
      return { ok: false, reason: bn ? 'ছবিতে পড়ার মতো লেখা পাওয়া যায়নি। বাংলা লেখা হলে: অ্যাপের বিল্ট-ইন রিডার বাংলা পড়তে পারে না — ছবি পড়তে পারে এমন AI মডেল যোগ করলে পড়বে।' : 'No readable text was found. The built-in reader cannot read Bengali — adding an AI model that reads images makes it possible.' };
    }
    return { ok: true, text, reader: 'mlkit', ...(looksLikeMissedBengali(text) ? { note: bn ? 'শুধু ইংরেজি অংশ পড়া গেছে — বাংলা লেখা পড়তে ছবি পড়তে পারে এমন AI মডেল লাগবে।' : 'Only the English part could be read — Bengali needs an AI model that reads images.' } : {}) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Take or choose a photograph and hand back the text in it.
 *
 * Goes through `stagePhoto` rather than calling the picker directly, because that function
 * already asks for the permission before opening — a lesson learned the hard way, since
 * `launchCameraAsync` does not request on its own and simply fails, which reads to the user
 * as a broken feature rather than a missing permission. The staged copy is deleted straight
 * afterwards: this path wants the words, not the file, and an image nobody asked to keep
 * should not quietly accumulate in the attachment folder.
 */
export async function captureAndReadText(
  db: SQLiteDatabase,
  source: 'camera' | 'gallery',
  bn = true,
  /** Keep the photo so the line picker can show it; the caller then calls discardOcrImage. */
  keepImage = false,
): Promise<OcrResult & { cancelled?: boolean; imageUri?: string }> {
  const staged = await stagePhoto(source, true);
  if (!staged.length) return { ok: false, cancelled: true };
  let kept = false;
  try {
    const read = await readTextFromImage(db, staged[0]!.uri, bn);
    kept = keepImage && read.ok;
    return kept ? { ...read, imageUri: staged[0]!.uri } : read;
  } finally {
    for (const item of kept ? staged.slice(1) : staged) {
      try { const file = new File(item.uri); if (file.exists) file.delete(); } catch { /* noop */ }
    }
  }
}

/** Delete a photo kept for the line picker (captureAndReadText with keepImage). */
export function discardOcrImage(uri: string | null | undefined): void {
  if (!uri) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* noop */ }
}
