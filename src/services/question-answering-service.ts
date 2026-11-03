import type { SQLiteDatabase } from 'expo-sqlite';
import type { Memory } from '../types/memory-model';
import type { Task } from '../types/task-model';
import { classifyQuestionType, type QuestionType } from '../ai/nlp/keywords';
import { normalizeText } from '../ai/nlp/normalize';
import { synonymsOf } from '../ai/semantic';
import { searchRankedMemories } from './memory-search-service';
import { semanticSearchMemories } from './semantic-memory-service';
import { searchTasks } from './task-service';
import { collectFacts } from '../modules';
import { explainLimit, findKnowledge, looksLikeAppQuestion } from './app-knowledge';

// Deterministic, on-device question answering — a small retrieval-and-extract pipeline,
// no model and no network:
//   1. Retrieve   – hybrid: lexical keyword ranking ∪ semantic (embedding) similarity
//                   over stored memories, then tasks.
//   2. Ground     – keep a source only when lexical coverage OR semantic similarity is
//                   strong enough; otherwise we say we don't know.
//   3. Extract    – pull the answer span that matches the question type
//                   (quantity / time / place / person / generic).
//   4. Compose    – a short bilingual reply, always with the source snippet.
//   5. Guardrails – below the confidence floor we say we don't know instead of guessing.

export type AnswerLanguage = 'bn' | 'en';

export interface AnswerSource {
  id: string;
  origin: 'MEMORY' | 'TASK' | 'DEBT' | 'APP';
  snippet: string;
}

export interface AnswerResult {
  type: 'ANSWER' | 'NO_ANSWER';
  /** The composed, user-facing reply. Always populated. */
  text: string;
  /** The extracted value, when a specific span was found ("2030 সাল"). */
  span?: string;
  /** 0..1 — retrieval coverage + span bonus. */
  confidence: number;
  questionType: QuestionType;
  sources: AnswerSource[];
  /** Step log for diagnostics/monitoring; never shown to the user. */
  trace: string[];
}

const MIN_COVERAGE = 0.5;
// Semantic acceptance: a strong embedding match can stand in for exact keywords, but
// only with at least a toe-hold of lexical overlap so we never answer from a note that
// merely "feels" related.
const MIN_SEMANTIC = 0.16;
const STRONG_SEMANTIC = 0.4;
const SNIPPET_MAX = 160;

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function toBengaliDigits(value: string): string {
  return value.replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}
function forLang(value: string, lang: AnswerLanguage): string {
  return lang === 'bn' ? toBengaliDigits(value) : value;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function clampSnippet(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX - 1)}…` : clean;
}

/** Split into sentence-ish units and return the one that covers the most keywords. */
function bestSentence(haystack: string, keywords: string[]): string {
  const parts = haystack
    .split(/(?<=[।.!?\n])\s+|[\n;]+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) return haystack.trim();
  let best = parts[0]!;
  let bestHits = -1;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const hits = keywords.reduce((n, k) => (lower.includes(k) ? n + 1 : n), 0);
    if (hits > bestHits) { best = part; bestHits = hits; }
  }
  return best;
}

const MONTHS =
  '(?:january|february|march|april|may|june|july|august|september|october|november|december|জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর|জানুয়ারী|ফেব্রুয়ারী)';
const REL_DAY = '(?:today|tomorrow|yesterday|tonight|আজ|আগামীকাল|কাল|পরশু|গতকাল)';

/** Trim leading/trailing separators and filler that regex capture sometimes leaves behind. */
function tidySpan(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^[\s\-:=–—,.।]+/u, '').replace(/[\s\-:=–—,.।]+$/u, '').trim();
  return cleaned || undefined;
}

/**
 * The text that comes *after* the question's subject in the sentence — "গাড়ির নম্বর
 * ঢাকা মেট্রো গ ১২-৩৪৫৬" → "ঢাকা মেট্রো গ ১২-৩৪৫৬". Beats a bare-number regex for
 * plate numbers, addresses, names, and free-form facts.
 */
function valueAfterSubject(s: string, keywords: string[]): string | undefined {
  let cut = -1;
  for (const k of keywords) {
    if (k.length < 2) continue;
    const i = s.lastIndexOf(k);
    if (i >= 0) cut = Math.max(cut, i + k.length);
  }
  if (cut < 0) return undefined;
  let tail = s.slice(cut).replace(/^[\s:=\-–—,।"'()]+/u, '').replace(/[\s।.;!?,)"']+$/u, '').trim();
  // Drop a leading copula / filler left dangling after the subject noun.
  tail = tail.replace(/^(?:হলো|হল|হচ্ছে|হয়|is|was|are|=|:|এর|টা|টি|নম্বর|no\.?|number)\s+/u, '').trim();
  const words = tail.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 9) return undefined;
  return tail;
}

/** Pull the answer span from a sentence, guided by the question type. */
function extractSpan(sentence: string, type: QuestionType, keywords: string[] = []): string | undefined {
  const s = normalizeText(sentence); // digits → ASCII, lower-cased, NFKC
  const tail = valueAfterSubject(s, keywords);

  const year = s.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/u)?.[0];
  const isoDate = s.match(/(?<!\d)\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?!\d)/u)?.[0];
  const monthDate = s.match(new RegExp(`(?:\\d{1,2}\\s+)?${MONTHS}(?:\\s+\\d{1,4})?`, 'u'))?.[0];
  const relDay = s.match(new RegExp(REL_DAY, 'u'))?.[0];
  const clock = s.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm|টা|টায়)/u)?.[0];
  const numberWithUnit = s.match(
    /\d[\d,]*(?:\.\d+)?\s*(?:সাল|টাকা|tk|৳|\$|percent|%|শতাংশ|বছর|মাস|সপ্তাহ|দিন|ঘণ্টা|ঘন্টা|মিনিট|কেজি|kg|জন|টি|টা|বার|kilo|km|মিটার|gb|mb)?/u,
  )?.[0]?.trim();

  if (type === 'TIME') {
    return tidySpan(year ?? isoDate ?? monthDate ?? relDay ?? clock ?? numberWithUnit ?? tail);
  }
  if (type === 'QUANTITY') {
    // A multi-token tail with a digit ("ঢাকা মেট্রো গ ১২-৩৪৫৬", "01712-345678") is a
    // better answer than the first stray number the regex finds.
    if (tail && /\d/u.test(tail) && (!numberWithUnit || tail.length > numberWithUnit.length + 1)) {
      return tidySpan(tail);
    }
    return tidySpan(numberWithUnit ?? year ?? isoDate ?? tail);
  }
  if (type === 'PERSON') {
    // "… নাম <X>" / "name is <X>" / "… হলেন <X>"
    const m = s.match(/(?:name\s+is|নাম\s*[:\-]?|হলেন|হল|হচ্ছে|is)\s+([^\s।.,;]+(?:\s+[^\s।.,;]+){0,2})/u);
    return tidySpan(m?.[1] ?? tail);
  }
  if (type === 'PLACE') {
    const m = s.match(/(?:address\s+is|ঠিকানা\s*[:\-]?|located\s+at|at\s+|in\s+|এ\s+আছে|তে\s+আছে|রেখেছি|রাখা\s+আছে)\s*([^।.;]+)/u);
    return tidySpan(m?.[1] ?? tail);
  }
  // GENERIC: whatever follows a copula / colon, else the text after the subject.
  const copula = s.match(/(?:\bis\b|\bare\b|হল|হলো|হচ্ছে|:|=)\s*([^।.;]+)/u);
  return tidySpan(copula?.[1] || tail || year || numberWithUnit);
}

/** Fraction of keyword *concepts* (a keyword or any of its synonyms) present in `text`. */
function keywordCoverage(text: string, concepts: string[][]): number {
  if (concepts.length === 0) return 0;
  const lower = normalizeText(text);
  const hit = concepts.filter((forms) => forms.some((f) => lower.includes(f))).length;
  return concepts.length ? hit / concepts.length : 0;
}

/**
 * True when the question's head subject is actually in `text`. The first keyword is the
 * head noun ("ভিসা", "passport"); requiring it — not merely "any early keyword" — is what
 * stops a visa question being answered from a passport note that only shares "মেয়াদ".
 */
function subjectPresent(text: string, concepts: string[][]): boolean {
  const lower = normalizeText(text);
  const head = concepts[0];
  return !!head && head.some((f) => lower.includes(f));
}

function composeAnswer(
  lang: AnswerLanguage,
  span: string | undefined,
  snippet: string,
  origin: 'MEMORY' | 'TASK' | 'DEBT' | 'APP',
): string {
  const src = clampSnippet(snippet);
  if (span) {
    const value = forLang(span, lang);
    return lang === 'bn'
      ? `উত্তর: ${value}\n(আপনার ${originBn(origin)} থেকে: “${forLang(src, lang)}”)`
      : `Answer: ${value}\n(from your ${originEn(origin)}: “${src}”)`;
  }
  return lang === 'bn'
    ? `আপনার ${originBn(origin)} অনুযায়ী:\n“${forLang(src, lang)}”`
    : `From your ${originEn(origin)}:\n“${src}”`;
}

/**
 * What to say when there is no answer.
 *
 * It takes the question, because "I don't know" is not one sentence: someone asking how
 * the app works deserves to hear what it *can* do, and someone asking about their own
 * records deserves to hear that only this phone was searched. Both deserve the reason.
 */
function noAnswer(lang: AnswerLanguage, type: QuestionType, trace: string[], question = ''): AnswerResult {
  return {
    type: 'NO_ANSWER',
    text: explainLimit(question, lang),
    confidence: 0,
    questionType: type,
    sources: [],
    trace,
  };
}

function taskWhen(task: Task, lang: AnswerLanguage): string | undefined {
  const raw = task.dueAt ?? task.plannedDate ?? undefined;
  if (!raw) return undefined;
  return forLang(raw.replace('T', ' ').slice(0, 16), lang);
}

const originBn = (o: 'MEMORY' | 'TASK' | 'DEBT' | 'APP'): string =>
  o === 'TASK' ? 'টাস্ক' : o === 'DEBT' ? 'দেনা-পাওনার হিসাব' : o === 'APP' ? 'অ্যাপ' : 'নোট';
const originEn = (o: 'MEMORY' | 'TASK' | 'DEBT' | 'APP'): string =>
  o === 'TASK' ? 'task' : o === 'DEBT' ? 'debt records' : o === 'APP' ? 'the app' : 'note';

export interface AnswerQuestionInput {
  question: string;
  keywords: string[];
  language?: AnswerLanguage;
}

export async function answerQuestion(
  db: SQLiteDatabase,
  input: AnswerQuestionInput,
): Promise<AnswerResult> {
  const lang: AnswerLanguage = input.language ?? 'bn';
  const type = classifyQuestionType(input.question);
  const keywords = uniq(input.keywords).slice(0, 8);
  const trace: string[] = [`q="${input.question}"`, `type=${type}`, `keywords=[${keywords.join(', ')}]`];

  // ── 0. Is this a question about the app itself? ────────────────────────────
  //
  // Asked first, and only when the question is *phrased* as one — "কীভাবে", "where is",
  // "can you". A note that happens to contain the word "backup" is not a better answer to
  // "how do I back up" than the app's own answer, but it would win on keyword overlap
  // alone, so the shape of the question is what decides which half of me replies.
  if (looksLikeAppQuestion(input.question)) {
    const known = findKnowledge(input.question, 2);
    if (known) {
      trace.push(`app.knowledge=${known.id}`);
      return {
        type: 'ANSWER',
        text: known.answer[lang],
        span: undefined,
        confidence: 0.9,
        questionType: type,
        sources: [{ id: known.id, origin: 'APP', snippet: known.title[lang] }],
        trace,
      };
    }
  }

  if (keywords.length === 0) return noAnswer(lang, type, [...trace, 'no-keywords'], input.question);

  // Each keyword becomes a "concept" = the word plus its bilingual synonyms, so a
  // question in English can still match a Bengali note (and vice-versa).
  const concepts = keywords.map((k) => uniq([k, ...synonymsOf(k)]));
  const query = keywords.join(' ');

  try {
    // ── 1. Hybrid retrieval over memories: lexical keywords ∪ semantic embeddings ──
    const [ranked, semantic] = await Promise.all([
      searchRankedMemories(db, query),
      semanticSearchMemories(db, input.question, 8).catch(() => []),
    ]);
    trace.push(`memories.lexical=${ranked.length}`, `memories.semantic=${semantic.length}`);

    const candidates = new Map<string, { memory: Memory; coverage: number; subject: boolean; sem: number }>();
    const consider = (memory: Memory, sem: number) => {
      const haystack = `${memory.title ?? ''} ${memory.content} ${memory.tags.join(' ')}`;
      const existing = candidates.get(memory.id);
      if (existing) { existing.sem = Math.max(existing.sem, sem); return; }
      candidates.set(memory.id, {
        memory,
        coverage: keywordCoverage(haystack, concepts),
        subject: subjectPresent(haystack, concepts),
        sem,
      });
    };
    for (const memory of ranked.slice(0, 8)) consider(memory, 0);
    for (const hit of semantic) consider(hit.memory, hit.score);

    // Rank by a blend (lexical coverage dominates; semantic breaks ties / boosts recall).
    const scored = [...candidates.values()]
      .map((c) => ({ ...c, blend: c.coverage * 0.6 + Math.min(1, c.sem / STRONG_SEMANTIC) * 0.4 }))
      .sort((a, b) => b.blend - a.blend);
    const best = scored[0];

    // Guardrail: never answer unless the question's subject is actually in the note,
    // then require solid keyword coverage OR decent coverage plus a semantic signal.
    const accepted =
      best &&
      best.subject &&
      (best.coverage >= MIN_COVERAGE || (best.coverage >= 0.34 && best.sem >= MIN_SEMANTIC));

    // Up to three on-subject notes as sources, best first — transparency about where
    // the answer came from, and useful extra context when the top note is terse.
    const onSubjectSources = (): AnswerSource[] =>
      scored
        .filter((c) => c.subject)
        .slice(0, 3)
        .map((c) => ({ id: c.memory.id, origin: 'MEMORY' as const, snippet: clampSnippet(c.memory.content) }));

    if (best && accepted) {
      trace.push(`memory.match coverage=${best.coverage.toFixed(2)} sem=${best.sem.toFixed(2)} subject=${best.subject}`);
      const sentence = bestSentence(best.memory.content, keywords);
      const span = extractSpan(sentence, type, keywords);
      const confidence = Math.min(
        0.99,
        0.35 + best.coverage * 0.4 + Math.min(0.2, best.sem * 0.4) + (span ? 0.12 : 0),
      );
      trace.push(`span=${span ?? '∅'}`, `confidence=${confidence.toFixed(2)}`);
      return {
        type: 'ANSWER',
        text: composeAnswer(lang, span, sentence, 'MEMORY'),
        span,
        confidence,
        questionType: type,
        sources: onSubjectSources(),
        trace,
      };
    }

    // ── Soft tier ────────────────────────────────────────────────────────────────
    // The strict floor was missed, but the top note is unambiguously about the same
    // subject and does carry real (if partial) keyword overlap. Returning it as a
    // best-effort answer — clearly sourced, lower confidence — is far more useful
    // than a blank "I don't know" when the note the user wants is sitting right there.
    if (best && best.subject && (best.coverage >= 0.3 || best.sem >= MIN_SEMANTIC)) {
      const sentence = bestSentence(best.memory.content, keywords);
      const span = extractSpan(sentence, type, keywords);
      const confidence = Math.min(0.7, 0.25 + best.coverage * 0.4 + (span ? 0.1 : 0));
      trace.push(`memory.soft coverage=${best.coverage.toFixed(2)} sem=${best.sem.toFixed(2)} span=${span ?? '∅'}`);
      return {
        type: 'ANSWER',
        text: composeAnswer(lang, span, sentence, 'MEMORY'),
        span,
        confidence,
        questionType: type,
        sources: onSubjectSources(),
        trace,
      };
    }
    trace.push(`memory.rejected best=${best ? `${best.blend.toFixed(2)}/subj=${best.subject}` : 'none'}`);

    // ── 2. Fall back to tasks ───────────────────────────────────────────────────
    const tasks = await searchTasks(db, query, 10);
    trace.push(`tasks.matched=${tasks.length}`);
    let bestTask: Task | undefined;
    let bestTaskCoverage = 0;
    for (const task of tasks) {
      const hay = `${task.title} ${task.notes ?? ''}`;
      const coverage = keywordCoverage(hay, concepts);
      if (coverage > bestTaskCoverage && subjectPresent(hay, concepts)) { bestTaskCoverage = coverage; bestTask = task; }
    }
    if (bestTask && bestTaskCoverage >= MIN_COVERAGE) {
      const when = (type === 'TIME' || type === 'QUANTITY') ? taskWhen(bestTask, lang) : undefined;
      const confidence = Math.min(0.9, 0.35 + bestTaskCoverage * 0.4 + (when ? 0.15 : 0));
      trace.push(`task.span=${when ?? '∅'}`, `confidence=${confidence.toFixed(2)}`);
      return {
        type: 'ANSWER',
        text: composeAnswer(lang, when, bestTask.title, 'TASK'),
        span: when,
        confidence,
        questionType: type,
        sources: [{ id: bestTask.id, origin: 'TASK', snippet: clampSnippet(bestTask.title) }],
        trace,
      };
    }

    // ── 3. Fall back to what the modules know ───────────────────────────────────
    //
    // Deliberately last: a note that actually answers the question should always win.
    // Which modules contribute is decided by their own declared vocabulary, so this file
    // never learns what domains exist — the debt ledger today, health or study tomorrow.
    {
      const facts = await collectFacts(db, lang === 'en' ? 'en' : 'bn', input.question).catch(() => [] as string[]);
      trace.push(`modules.facts=${facts.length}`);
      // Only a line that is actually about the question answers it. The unconditional
      // summary this used to fall back to put a debt digest under "বাংলাদেশের রাজধানী কী?"
      // — and, answering everything, left no question for the general-knowledge step.
      const named = facts.find((line) => keywordCoverage(line, concepts) >= MIN_COVERAGE);
      if (facts.length && !named) trace.push('modules.unrelated');
      if (named) {
        const chosen = named;
        const confidence = 0.82;
        trace.push('modules.matched=named', `confidence=${confidence.toFixed(2)}`);
        return {
          type: 'ANSWER',
          text: composeAnswer(lang, undefined, chosen, 'DEBT'),
          span: undefined,
          confidence,
          questionType: type,
          sources: facts.slice(0, 3).map((line, i) => ({ id: `debt-${i}`, origin: 'DEBT' as const, snippet: clampSnippet(line) })),
          trace,
        };
      }
    }

    // ── 4. Last, what the app can say about itself ─────────────────────────────
    //
    // Reached by questions that were not phrased as app questions but turn out to be
    // about one — "ব্যাকআপ?" on its own, for instance. A lower bar than step 0, because
    // by here every other source has already declined to answer.
    {
      const known = findKnowledge(input.question, 2);
      if (known) {
        trace.push(`app.knowledge.fallback=${known.id}`);
        return {
          type: 'ANSWER',
          text: known.answer[lang],
          span: undefined,
          confidence: 0.6,
          questionType: type,
          sources: [{ id: known.id, origin: 'APP', snippet: known.title[lang] }],
          trace,
        };
      }
    }

    return noAnswer(lang, type, [...trace, 'below-floor'], input.question);
  } catch (error) {
    trace.push(`error=${error instanceof Error ? error.message : String(error)}`);
    return noAnswer(lang, type, trace, input.question);
  }
}
