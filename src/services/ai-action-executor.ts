import type { SQLiteDatabase } from 'expo-sqlite';
import type { OrchestratedAction } from '../ai/orchestrator';
import { addMemory, findMemories } from './memory-service';
import { addTask, completeTask, editTask, findTasksByExactTitle, listTasks, rescheduleTask, searchTasks } from './task-service';
import { answerQuestion, type AnswerLanguage, type AnswerResult } from './question-answering-service';
import { askAboutMoney, type QueryMatch, type MoneyQuestion } from './life-query-service';
import { addEntry, type FinanceEntry, type FundSource } from './finance-service';
import { listWallets, type Wallet } from './wallet-service';
import { createDebtWithTransaction, createReceivableWithTransaction } from './debt/debt-service';
import { recordWalletSideOfNewDebt } from './money-bridge';
import { atomic } from '../database/atomic';
import { createPerson, listPeople } from './debt/repository';
import type { Account } from './debt/types';
import { bangladeshDateKey , formatBangladeshDate } from '../i18n/date-time';
import { eventTypeLabel, eventWord } from './life-event-copy';
import { formatPaisa , asciiDigitsToBengali } from './debt/money';
import { semanticSearchMemories } from './semantic-memory-service';
import { polishAnswerDetailed } from '../ai/engine/nlg';
import { explainWithFacts } from '../ai/engine/analysis-nlg';
import { answerFromGeneralKnowledge } from '../ai/engine/general-answer';
import { basicFactAnswer } from '../ai/basic-facts';
import { analyzeSpending, describeSpending, type SpendingAnalysis } from './spending-analysis';
import { getPreferredEngineId } from '../ai/engine/registry';
import { helpTopics, smallTalkReply, type HelpTopic } from '../ai/assistant/conversation';
import type { Memory } from '../types/memory-model';
import { SCREENS, type ScreenId } from '../ai/capabilities';
import type { Task } from '../types/task-model';

/**
 * Turn matched records into the shape the assistant already speaks in.
 *
 * The sentence is the answer; the lines under it are the evidence, one per record, so a
 * figure the app states can always be traced back to the row it came from. Confidence is
 * high and honest here: unlike a retrieved memory, these are the records themselves — the
 * only uncertainty is whether the question was read correctly, and a question that parsed
 * to nothing never reaches this function.
 */
function recordsAnswer(
  found: { parsed: MoneyQuestion; matches: QueryMatch[]; answer: string },
  language: AnswerLanguage,
): AnswerResult {
  const bn = language === 'bn';
  const lines = found.matches.slice(0, 6).map((m) => {
    const when = formatBangladeshDate(m.occurredAt, bn ? 'bn' : 'en');
    const sum = m.amountPaisa ? formatPaisa(m.amountPaisa, { symbol: true, bnDigits: bn }) : '';
    const what = m.title?.trim() || eventTypeLabel(m.type, bn ? 'bn' : 'en');
    const extra = [m.personName, m.place, eventWord(m.purpose, bn ? 'bn' : 'en')].filter(Boolean).join(' · ');
    return `• ${when} — ${sum} ${what}${extra ? ` (${extra})` : ''}`.replace(/\s+/gu, ' ').trim();
  });

  const more = found.matches.length > 6
    ? (bn ? `\n…আরও ${asciiDigitsToBengali(String(found.matches.length - 6))}টি` : `\n…and ${found.matches.length - 6} more`)
    : '';

  return {
    type: 'ANSWER',
    text: [found.answer, ...lines].join('\n') + more,
    span: found.matches[0]?.amountPaisa
      ? formatPaisa(found.matches[0].amountPaisa, { symbol: true, bnDigits: bn })
      : undefined,
    confidence: 0.95,
    // A sum, a date, or both — which is what this whole path exists to answer.
    questionType: found.parsed.amountPaisa !== undefined ? 'QUANTITY' : 'TIME',
    sources: found.matches.slice(0, 6).map((m) => ({
      id: m.id,
      origin: 'APP' as const,
      snippet: `${m.occurredAt.slice(0, 10)} ${m.title ?? m.type}`,
    })),
    trace: ['life-query', `matched:${found.matches.length}`],
  };
}

export type ActionExecutionResult =
  | { type: 'TASK_CREATED'; task: Task }
  | { type: 'TASK_COMPLETED'; task: Task }
  | { type: 'TASKS_LISTED'; tasks: Task[] }
  | { type: 'TASK_RESCHEDULED'; task: Task }
  | { type: 'MEMORY_CREATED'; memory: Memory }
  | { type: 'MEMORIES_FOUND'; memories: Memory[] }
  // `askedMoney` is set only when the records answered it; the screen keeps it so the
  // next sentence can be read as a follow-up.
  | { type: 'QUESTION_ANSWERED'; answer: AnswerResult; askedMoney?: MoneyQuestion }
  | { type: 'ENTRY_RECORDED'; entry: FinanceEntry }
  /** The sentence named no wallet and the phone has more than one — ask, do not guess (T05). */
  | { type: 'NEEDS_WALLET'; wallets: Wallet[]; pending: PendingEntry }
  | { type: 'DEBT_CREATED'; account: Account; personName: string }
  | { type: 'HELP_SHOWN'; intro: string; topics: HelpTopic[]; outro: string }
  | { type: 'SMALL_TALK_REPLY'; message: string }
  | { type: 'SPENDING_ANALYZED'; analysis: SpendingAnalysis; text: string; trace: string[] }
  /** Any other part of the app. `navigate` = open `open` straight away (the person asked to). */
  | { type: 'APP_REPLY'; text: string; open?: ScreenId; navigate?: boolean; done?: boolean; trace: string[] };

/** An entry waiting only for its wallet. */
/**
 * A money movement waiting for what only the person can say: which wallet, and — for money
 * going out — whose money it was. Nothing is written until both are answered.
 */
export type PendingEntry =
  | { kind: 'INCOME' | 'EXPENSE'; amountPaisa: number; category: string; occurredOn?: string; note?: string | null }
  | { kind: 'NEW_DEBT'; direction: 'DEBT' | 'RECEIVABLE'; personName: string; amountPaisa: number; occurredOn?: string; note?: string | null };

/** Money going out names its source: spending, and lending. Borrowing is always loan money. */
export const pendingNeedsSource = (pending: PendingEntry): boolean =>
  pending.kind === 'EXPENSE' || (pending.kind === 'NEW_DEBT' && pending.direction === 'RECEIVABLE');

export type PendingSaved =
  | { type: 'ENTRY_RECORDED'; entry: FinanceEntry }
  | { type: 'DEBT_CREATED'; account: Account; personName: string };

export interface ActionExecutionContext {
  language?: AnswerLanguage;
  /** The money question asked just before this one, so a follow-up keeps its subject. */
  previousMoney?: MoneyQuestion;
  /** Allow an installed on-device LLM to rephrase (never re-fact) an answer. */
  enhance?: boolean;
}

/** Raised when a task reference matches more than one active task — the caller
 * should ask the user which one they meant instead of silently failing. */
export class AmbiguousTaskError extends Error {
  constructor(public candidates: Task[], public actionType: 'COMPLETE_TASK' | 'RESCHEDULE_TASK') {
    super('Referenced task is ambiguous');
    this.name = 'AmbiguousTaskError';
  }
}

const CLOSED = new Set(['COMPLETED', 'ARCHIVED', 'CANCELLED']);

function buildDueAt(action: Extract<OrchestratedAction, { type: 'CREATE_TASK' | 'RESCHEDULE_TASK' }>, preserveTimeFrom?: string | null): string | null {
  if (action.dueMinutes !== undefined && !action.dueDate) throw new Error('A due date is required when a task time is supplied');
  if (!action.dueDate) return null;
  let minutes = action.dueMinutes;
  if (minutes === undefined && preserveTimeFrom) {
    const match = preserveTimeFrom.match(/T(\d{2}):(\d{2})/u);
    if (match) minutes = Number(match[1]) * 60 + Number(match[2]);
  }
  if (minutes === undefined) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) throw new Error('Task due time must be between 00:00 and 23:59');
  return `${action.dueDate}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

/**
 * Write the waiting movement, now that the wallet (and, for money going out, the source) is
 * known. A new loan goes through the same path the debt screen uses: the ledger row and its
 * wallet side in one boundary, linked — never a loan whose money came from nowhere.
 */
export async function savePendingEntry(
  db: SQLiteDatabase,
  pending: PendingEntry,
  walletId: string,
  source: { fundSource: FundSource | null; fundAccountId?: string | null; fundNote?: string | null } = { fundSource: null },
): Promise<PendingSaved> {
  const out = pendingNeedsSource(pending);
  const fundSource = out ? source.fundSource : null;
  const fundAccountId = out && fundSource === 'LOAN' ? (source.fundAccountId ?? null) : null;
  const fundNote = out && fundSource === 'OTHER' ? (source.fundNote ?? null) : null;
  if (pending.kind === 'NEW_DEBT') {
    return atomic(db, async () => {
      // Same rule `debt/new.tsx` uses: reuse a person whose name matches exactly.
      const name = pending.personName.trim();
      const people = await listPeople(db);
      const existing = people.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      const personId = existing ? existing.id : (await createPerson(db, { name })).id;
      const openedDate = pending.occurredOn ?? bangladeshDateKey(new Date());
      const create = pending.direction === 'DEBT' ? createDebtWithTransaction : createReceivableWithTransaction;
      const { account, transaction } = await create(db, {
        personId, principalPaisa: pending.amountPaisa, openedDate,
        title: pending.note?.trim() || null,
      });
      await recordWalletSideOfNewDebt(db, {
        transactionId: transaction.id, direction: pending.direction, amountPaisa: pending.amountPaisa,
        walletId, occurredAt: openedDate, personId, fundSource, fundAccountId, fundNote,
      });
      return { type: 'DEBT_CREATED' as const, account, personName: existing?.name ?? name };
    });
  }
  const entry = await addEntry(db, {
    kind: pending.kind,
    amount: pending.amountPaisa,
    category: pending.category,
    occurredAt: pending.occurredOn ? `${pending.occurredOn}T12:00:00.000Z` : undefined,
    note: pending.note ?? null,
    walletId, fundSource, fundAccountId, fundNote,
  });
  return { type: 'ENTRY_RECORDED', entry };
}

async function findTaskByReference(
  db: SQLiteDatabase,
  reference: string,
  actionType: 'COMPLETE_TASK' | 'RESCHEDULE_TASK',
): Promise<Task> {
  // Exact title wins outright; otherwise fall back to a fuzzy search so a user does
  // not have to reproduce the stored title verbatim.
  const exact = (await findTasksByExactTitle(db, reference)).filter((task) => !CLOSED.has(task.status));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new AmbiguousTaskError(exact.slice(0, 5), actionType);

  const fuzzy = (await searchTasks(db, reference, 20)).filter((task) => !CLOSED.has(task.status));
  if (fuzzy.length === 0) throw new Error('Referenced task was not found');
  if (fuzzy.length === 1) return fuzzy[0]!;
  throw new AmbiguousTaskError(fuzzy.slice(0, 5), actionType);
}

export async function executeAiAction(
  db: SQLiteDatabase,
  action: Exclude<OrchestratedAction, { type: 'CLARIFY' }>,
  ctx: ActionExecutionContext = {},
): Promise<ActionExecutionResult> {
  switch (action.type) {
    case 'CREATE_TASK': {
      const task = await addTask(db, { title: action.taskText, dueAt: buildDueAt(action), plannedDate: action.dueDate ?? null, recurrence: action.recurrence ?? null });
      return { type: 'TASK_CREATED', task };
    }
    case 'COMPLETE_TASK': {
      const target = await findTaskByReference(db, action.taskText, 'COMPLETE_TASK'); const task = await completeTask(db, target.id);
      if (!task) throw new Error('Task disappeared before completion');
      return { type: 'TASK_COMPLETED', task };
    }
    case 'LIST_TASKS': return { type: 'TASKS_LISTED', tasks: await listTasks(db) };
    case 'RESCHEDULE_TASK': {
      const target = await findTaskByReference(db, action.taskText, 'RESCHEDULE_TASK'); const dueAt = buildDueAt(action, target.dueAt);
      if (dueAt) { const task = await rescheduleTask(db, target.id, dueAt); if (!task) throw new Error('Task disappeared before rescheduling'); return { type: 'TASK_RESCHEDULED', task }; }
      if (!action.dueDate) throw new Error('A schedule is required to reschedule a task');
      const task = await editTask(db, target.id, { status: 'PLANNED', dueAt: null, plannedDate: action.dueDate });
      if (!task) throw new Error('Task disappeared before rescheduling');
      return { type: 'TASK_RESCHEDULED', task };
    }
    case 'CREATE_MEMORY': return { type: 'MEMORY_CREATED', memory: await addMemory(db, { content: action.content, tags: action.tags }) };
    case 'SEARCH_MEMORY': {
      // Hybrid: exact/keyword matches first (these also refresh last-accessed), then
      // semantically-close notes the keyword search would have missed.
      const lexical = await findMemories(db, action.query);
      const seen = new Set(lexical.map((m) => m.id));
      const semantic = await semanticSearchMemories(db, action.query, 10).catch(() => []);
      const merged = [...lexical, ...semantic.filter((h) => !seen.has(h.memory.id)).map((h) => h.memory)];
      return { type: 'MEMORIES_FOUND', memories: merged.slice(0, 25) };
    }
    case 'RECORD_EXPENSE': {
      // The one assistant action that writes money. It goes through the same `addEntry`
      // every screen uses -- same validation, same wallet rules, same life event -- so a
      // spoken entry is indistinguishable from a typed one once it lands, and nothing
      // about the ledger has a second code path that could drift.
      //
      // The category is required by `addEntry` and deliberately not invented here: when
      // the sentence named none, it is filed under the app's own word for "other", which
      // is visible and editable, rather than a guess that looks deliberate.
      // Which wallet the money moved through is part of the record, not a detail (T05):
      // the screen always asks — even with one wallet, the person chooses it — and nothing
      // is written until it is answered.
      const pending: PendingEntry = {
        kind: action.kind,
        amountPaisa: action.amountPaisa,
        category: action.category?.trim() || (ctx.language === 'en' ? 'Other' : 'অন্যান্য'),
        ...(action.occurredOn ? { occurredOn: action.occurredOn } : {}),
        note: action.note?.trim() || null,
      };
      // Spending also names whose money it was. A lone wallet is never assumed, income too
      // (the user's rule: every money move has a wallet the person chose).
      const wallets = await listWallets(db).catch(() => [] as Wallet[]);
      return { type: 'NEEDS_WALLET', wallets, pending };
    }
    case 'CREATE_DEBT': {
      // Same rule `debt/new.tsx` uses: reuse a person whose name matches exactly, rather
      // than create a duplicate every time someone is mentioned a second time.
      //
      // A loan moves money, so it waits for its wallet like any entry does (the user's rule
      // for v1.0) — it used to be written with no wallet at all, the money arriving from
      // nowhere. Lending also names whose money it was.
      const pending: PendingEntry = {
        kind: 'NEW_DEBT', direction: action.direction, personName: action.personName.trim(),
        amountPaisa: action.amountPaisa,
        ...(action.occurredOn ? { occurredOn: action.occurredOn } : {}),
        note: action.note?.trim() || null,
      };
      // Borrowing into a lone wallet is asked too, never assumed.
      const wallets = await listWallets(db).catch(() => [] as Wallet[]);
      return { type: 'NEEDS_WALLET', wallets, pending };
    }
    case 'ANALYZE_SPENDING': {
      // Facts from the ledger first — complete without any AI. The AI, when ready, may only
      // explain them; its text is dropped if it states a number the facts do not contain.
      const language = ctx.language ?? 'bn';
      const analysis = await analyzeSpending(db, action.months);
      const facts = describeSpending(analysis, language);
      const trace = ['spending-analysis'];
      let text = facts;
      if (ctx.enhance && analysis.totalPaisa) {
        const preferredEngineId = await getPreferredEngineId(db).catch(() => null);
        const out = await explainWithFacts({
          facts,
          question: language === 'bn' ? 'আমার খরচ কোথায় বেশি যাচ্ছে, কীভাবে কমাব?' : 'Where is my money going and how can I spend less?',
          language,
          preferredEngineId,
        }).catch(() => null);
        if (out?.usedLlm) { text = `${out.text}\n\n${facts}`; trace.push('llm-polished', `llm-ms:${out.ms}`); }
        else if (out?.fallback && out.fallback !== 'not-ready') trace.push(`llm-fallback:${out.fallback}`);
      }
      return { type: 'SPENDING_ANALYZED', analysis, text, trace };
    }
    case 'APP_QUERY': {
      // Loaded on first use: it reaches notifications, diagnostics and the model manager,
      // none of which the core answering path should pay for at startup.
      const { answerAppQuery } = await import('./app-query-service');
      const reply = await answerAppQuery(db, action.topic, action.subject, ctx.language ?? 'bn');
      return { type: 'APP_REPLY', ...reply };
    }
    case 'APP_COMMAND': {
      const { runAppCommand } = await import('./app-query-service');
      const reply = await runAppCommand(db, action.topic, action.subject, ctx.language ?? 'bn');
      return { type: 'APP_REPLY', ...reply };
    }
    case 'OPEN_SCREEN': {
      const bn = (ctx.language ?? 'bn') === 'bn';
      const name = SCREENS[action.screen][bn ? 'bn' : 'en'];
      // Restore, delete and settings are done by the person on that screen, never here.
      const why = action.reason === 'restore'
        ? (bn ? 'নিরাপত্তার জন্য ব্যাকআপ থেকে ফেরত আনা আপন করে না — এই পাতা থেকে নিজে বেছে করুন।' : 'For safety Apon never restores a backup itself — pick one on this screen.')
        : action.reason === 'delete'
          ? (bn ? 'নিরাপত্তার জন্য সব মুছে ফেলা আপন দিয়ে করা যায় না। একটি একটি করে মুছতে বা ফেরত আনতে এই পাতা।' : 'For safety Apon never deletes data in bulk. Delete or restore items one by one here.')
          : action.reason === 'setting-change'
            ? (bn ? 'সেটিংস আপনি নিজে বদলান — এই পাতায় আছে।' : 'Settings are changed by you — they are on this screen.')
            : action.reason === 'repay'
              ? (bn ? 'টাকা ফেরত দেওয়া/পাওয়া এই পাতায় সেই মানুষের নামে লিখুন — তাহলে বাকি হিসাব ঠিক থাকবে।' : 'Record a repayment on this screen under that person, so the balance stays right.')
              : action.reason === 'write'
                ? (bn ? 'নিচের + বোতাম চেপে লিখুন।' : 'Tap the + button to write it.')
                : '';
      return { type: 'APP_REPLY', text: (bn ? `${name} খুলছি।` : `Opening ${name}.`) + (why ? `
${why}` : ''), open: action.screen, navigate: true, trace: ['open-screen', action.screen, action.reason] };
    }
    case 'SHOW_HELP': {
      const help = helpTopics(ctx.language ?? 'bn');
      return { type: 'HELP_SHOWN', ...help };
    }
    case 'SMALL_TALK':
      return { type: 'SMALL_TALK_REPLY', message: smallTalkReply(action.text, ctx.language ?? 'bn') };
    case 'ANSWER_QUESTION': {
      // The records are asked first, because a question with a sum or a date in it is
      // about what happened, and no amount of reading the diary will answer "where did
      // five hundred go last year". Memory retrieval stays the fallback: it is what
      // answers everything that is not a figure.
      const fromRecords = await askAboutMoney(
        db, action.question, ctx.language ?? 'bn', new Date(), ctx.previousMoney,
      ).catch(() => null);
      if (fromRecords && fromRecords.matches.length) {
        return {
          type: 'QUESTION_ANSWERED',
          answer: recordsAnswer(fromRecords, ctx.language ?? 'bn'),
          askedMoney: fromRecords.parsed,
        };
      }

      const answer = await answerQuestion(db, {
        question: action.question,
        keywords: action.keywords,
        language: ctx.language,
      });
      if (ctx.enhance && answer.type === 'ANSWER' && answer.span) {
        const [head, ...rest] = answer.text.split('\n');
        const preferredEngineId = await getPreferredEngineId(db).catch(() => null);
        const outcome = await polishAnswerDetailed({
          draft: head ?? answer.text,
          question: action.question,
          mustContain: answer.span,
          language: ctx.language ?? 'bn',
          preferredEngineId,
        }).catch(() => null);
        if (outcome?.usedLlm && outcome.text !== head) {
          answer.text = [outcome.text, ...rest].join('\n');
          answer.trace = [...answer.trace, 'llm-polished', `llm-ms:${outcome.ms}`];
        } else if (outcome?.fallback && outcome.fallback !== 'not-ready') {
          // The AI was asked and could not help this time — recorded so the answer card
          // can say so, instead of the user wondering whether the AI is running at all.
          answer.trace = [...answer.trace, `llm-fallback:${outcome.fallback}`];
        }
      }
      // A handful of common facts are known for certain and answered before any model,
      // with the AI on or off (RC.4 QA T38: the model named "বারান্দা" as the capital).
      if (answer.type === 'NO_ANSWER') {
        const bnLang = (ctx.language ?? 'bn') === 'bn';
        const fact = basicFactAnswer(action.question, bnLang);
        if (fact) {
          return { type: 'QUESTION_ANSWERED', answer: { ...answer, type: 'ANSWER', text: fact, confidence: 0.99, trace: [...answer.trace, 'basic-fact'] } };
        }
      }
      // Nothing saved answers it. A general question (not about this person's own life)
      // may still be answered by the on-device model — labelled as general knowledge.
      if (ctx.enhance && answer.type === 'NO_ANSWER') {
        const language = ctx.language ?? 'bn';
        const preferredEngineId = await getPreferredEngineId(db).catch(() => null);
        const general = await answerFromGeneralKnowledge(action.question, { language, preferredEngineId }).catch(() => null);
        if (general?.ok) {
          const note = language === 'bn'
            ? '🌐 সাধারণ জ্ঞান থেকে — আপনার সেভ করা তথ্য নয়, ভুলও হতে পারে।'
            : '🌐 From general knowledge — not something you saved, and it may be wrong.';
          return {
            type: 'QUESTION_ANSWERED',
            answer: { ...answer, type: 'ANSWER', text: `${general.text}

${note}`, trace: [...answer.trace, 'llm-general', `llm-ms:${general.ms}`] },
          };
        }
        // Asked and did not make it — the card says so instead of a bare "not found".
        if (general && !general.ok && (general.reason === 'timeout' || general.reason === 'error' || general.reason === 'empty')) {
          answer.trace = [...answer.trace, `llm-fallback:${general.reason}`];
        }
      }
      return { type: 'QUESTION_ANSWERED', answer };
    }
  }
}

/** Resolve a previously-ambiguous COMPLETE/RESCHEDULE against the task the user picked. */
export async function executeAiActionOnTask(
  db: SQLiteDatabase,
  action: Extract<OrchestratedAction, { type: 'COMPLETE_TASK' | 'RESCHEDULE_TASK' }>,
  taskId: string,
): Promise<ActionExecutionResult> {
  if (action.type === 'COMPLETE_TASK') {
    const task = await completeTask(db, taskId);
    if (!task) throw new Error('Task was not found');
    return { type: 'TASK_COMPLETED', task };
  }
  const dueAt = buildDueAt(action);
  if (dueAt) {
    const task = await rescheduleTask(db, taskId, dueAt);
    if (!task) throw new Error('Task was not found');
    return { type: 'TASK_RESCHEDULED', task };
  }
  if (!action.dueDate) throw new Error('A schedule is required to reschedule a task');
  const task = await editTask(db, taskId, { status: 'PLANNED', dueAt: null, plannedDate: action.dueDate });
  if (!task) throw new Error('Task was not found');
  return { type: 'TASK_RESCHEDULED', task };
}
