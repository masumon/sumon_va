import { resolveContext } from '../context';
import type { OrchestrationContext } from '../context';
import { parseLocalNlp } from '../nlp';
import type { NlpIntent } from '../nlp/types';
import type { OrchestratedAction, OrchestratorResult } from './types';

export * from './types';

function clarifyAction(reason: Extract<OrchestratedAction, { type: 'CLARIFY' }>['reason']): OrchestratedAction {
  return { type: 'CLARIFY', reason };
}

function hasTaskReference(value: string | undefined): value is string {
  const trimmed = value?.trim();
  // A short name is still a name ("মিটিংটা"); only a bare pronoun needs the last task.
  return Boolean(trimmed && trimmed.length >= 3 && !/^(?:এটা|এটি|ওটা|সেটা|এই\s*কাজটা|কাজটা|it|this|that)$/iu.test(trimmed) && !/(?:reschedule|move|postpone|delay|পিছ|পরে কর|দাও)$/u.test(trimmed));
}

// "কাল রহিমের জন্মদিন মনে রাখো" — "কাল" is stripped from the note and means nothing a
// week later, so the note keeps the real date it pointed at.
const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const RELATIVE_DAY = /(?:আজ|কাল|পরশু|today|tomorrow|yesterday)/iu;
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function withDate(content: string, date: { raw: string; isoDate: string } | undefined): string {
  // Only the words that change meaning with time; "শুক্রবার বন্ধ থাকে" is a standing fact.
  if (!date || !RELATIVE_DAY.test(date.raw) || content.includes(date.raw)) return content;
  const isoDate = date.isoDate;
  const m = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!m) return content;
  const [, y, mo, d] = m;
  const bn = /[ঀ-৿]/u.test(content);
  const toBn = (s: string) => s.replace(/\d/gu, (c) => '০১২৩৪৫৬৭৮৯'[Number(c)]!);
  const label = bn
    ? `${toBn(String(Number(d)))} ${BN_MONTHS[Number(mo) - 1]} ${toBn(y!)}`
    : `${Number(d)} ${EN_MONTHS[Number(mo) - 1]} ${y}`;
  return `${content} — ${label}`;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A clock time with no day is the next time it comes round (today if still ahead,
// otherwise tomorrow) — shown on the card before anything is saved.
// "১১:৩০-এ মনে করিয়ে দিও" said at 2 pm means tonight's 11:30, not tomorrow morning's:
// a clock time with no সকাল/রাত/am/pm is the next time that face of the clock comes round
// (RC.1 QA — the reminder and the words the user meant disagreed). Only for today or no
// day; an explicit other day keeps the plain reading.
const HAS_PERIOD = /(?:am|pm|a\.m|p\.m|সকাল|ভোর|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)/iu;
function scheduleFor(date: { raw: string; isoDate: string } | undefined, time: { raw: string; minutes: number } | undefined, now: Date): { dueDate?: string; dueMinutes?: number } {
  const today = localIso(now);
  let isoDate = date?.isoDate;
  // "৫ তারিখে বিল দিতে হবে" said on the 20th is next month's 5th — a task is not due in the past.
  if (isoDate && date && isoDate < today && /তারিখ/u.test(date.raw)) {
    const d = new Date(`${isoDate}T00:00:00`); d.setMonth(d.getMonth() + 1); isoDate = localIso(d);
  }
  if (!time) return { dueDate: isoDate };
  let minutes = time.minutes;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const h = Math.floor(minutes / 60);
  if (!HAS_PERIOD.test(time.raw) && h >= 1 && h <= 12 && (!isoDate || isoDate === today)) {
    const am = (h % 12) * 60 + (minutes % 60);
    const pm = am + 12 * 60;
    minutes = am > nowMin ? am : pm > nowMin ? pm : am;
  }
  // "আজ মধ্যরাতে": midnight belongs to the night that follows the day named.
  if (minutes === 0 && isoDate && /মধ্যরাত|মাঝরাত|গভীর রাত|midnight/u.test(time.raw)) {
    const d = new Date(`${isoDate}T00:00:00`); d.setDate(d.getDate() + 1); isoDate = localIso(d);
  }
  return { dueDate: isoDate ?? nextOccurrence(minutes, now), dueMinutes: minutes };
}

function nextOccurrence(minutes: number, now: Date): string {
  const day = new Date(now);
  if (minutes <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 1);
  return localIso(day);
}

function actionForIntent(
  intent: NlpIntent,
  entities: ReturnType<typeof parseLocalNlp>['entities'],
  context: OrchestrationContext,
  input = '',
  now = new Date(),
): {
  status: OrchestratorResult['status'];
  action: OrchestratedAction;
} {
  const resolved = resolveContext(entities, context);

  switch (intent) {
    case 'CREATE_TASK':
      if (!entities.taskText) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_TASK_TEXT') };
      return {
        status: 'READY',
        action: {
          type: 'CREATE_TASK',
          taskText: entities.taskText,
          ...scheduleFor(entities.date, entities.time, now),
          ...(entities.recurrence ? { recurrence: entities.recurrence } : {}),
        },
      };

    case 'COMPLETE_TASK':
      if (!resolved.taskText) {
        return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_TASK_REFERENCE') };
      }
      return {
        status: 'READY',
        action: { type: 'COMPLETE_TASK', taskText: resolved.taskText },
      };

    case 'LIST_TASKS':
      return { status: 'READY', action: { type: 'LIST_TASKS' } };

    case 'RESCHEDULE_TASK':
      if (!resolved.taskText) {
        return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_TASK_REFERENCE') };
      }
      if (!context.lastTaskText && !hasTaskReference(resolved.taskText)) {
        return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_TASK_REFERENCE') };
      }
      if (!entities.date && !entities.time) {
        return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_SCHEDULE') };
      }
      return {
        status: 'READY',
        action: {
          type: 'RESCHEDULE_TASK',
          taskText: resolved.taskText,
          ...scheduleFor(entities.date, entities.time, now),
        },
      };

    case 'RECORD_EXPENSE': {
      // Everything here comes out of the sentence itself. The amount is the only part
      // that must be present -- an entry without one is not an entry -- and it is the one
      // part the intent rule already guaranteed by matching on it.
      const money = entities.money;
      if (!money) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_AMOUNT') };
      // "ওটার জন্য ৫০০ যোগ করো": the category is whatever "ওটা" was — known only from the
      // conversation. With nothing to point at, ask rather than file it under a guess.
      if (money.categoryRef) {
        if (!context.lastExpenseCategory) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_CATEGORY_REFERENCE') };
        money.category = context.lastExpenseCategory;
      }
      return {
        status: 'READY',
        action: {
          type: 'RECORD_EXPENSE',
          kind: money.kind,
          amountPaisa: money.amountPaisa,
          category: money.category,
          note: money.category ?? '',
          occurredOn: entities.date?.isoDate,
        },
      };
    }

    case 'CREATE_DEBT': {
      // Both the amount and who it moved with are load-bearing — a debt with no person
      // owes nothing to anyone, which is not a debt at all.
      const debt = entities.debt;
      if (!debt) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_AMOUNT') };
      if (!debt.personName?.trim()) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_PERSON') };
      return {
        status: 'READY',
        action: {
          type: 'CREATE_DEBT',
          direction: debt.direction,
          amountPaisa: debt.amountPaisa,
          personName: debt.personName.trim(),
          note: '',
          occurredOn: entities.date?.isoDate,
        },
      };
    }

    case 'CREATE_MEMORY':
      if (!entities.memoryText) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_MEMORY_TEXT') };
      return {
        status: 'READY',
        action: { type: 'CREATE_MEMORY', content: withDate(entities.memoryText, entities.date), tags: entities.tags?.length ? entities.tags : undefined },
      };

    case 'SEARCH_MEMORY':
      // An empty string is a deliberate "list everything" request; only `undefined` means
      // we genuinely have nothing to search for.
      if (resolved.memoryQuery === undefined) return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_QUERY') };
      return { status: 'READY', action: { type: 'SEARCH_MEMORY', query: resolved.memoryQuery } };

    case 'ANSWER_QUESTION': {
      const question = entities.question?.trim();
      let keywords = entities.keywords ?? [];
      // A terse follow-up ("আর ভিসারটা?") carries too few words to retrieve on its own —
      // fold in the previous question's topic so the attribute (e.g. "মেয়াদ") is kept.
      if (keywords.length < 3 && context.lastKeywords?.length) {
        keywords = [...new Set([...keywords, ...context.lastKeywords])].slice(0, 6);
      }
      if (!question || keywords.length === 0) {
        return { status: 'NEEDS_INPUT', action: clarifyAction('MISSING_QUESTION') };
      }
      return { status: 'READY', action: { type: 'ANSWER_QUESTION', question, keywords } };
    }

    case 'ANALYZE_SPENDING':
      return { status: 'READY', action: { type: 'ANALYZE_SPENDING', months: entities.periodMonths ?? 3 } };

    case 'APP_QUERY':
      return entities.app?.kind === 'query'
        ? { status: 'READY', action: { type: 'APP_QUERY', topic: entities.app.topic, ...(entities.app.subject ? { subject: entities.app.subject } : {}) } }
        : { status: 'UNSUPPORTED', action: clarifyAction('UNKNOWN_INTENT') };

    case 'APP_COMMAND':
      return entities.app?.kind === 'command'
        ? { status: 'READY', action: { type: 'APP_COMMAND', topic: entities.app.topic, ...(entities.app.subject ? { subject: entities.app.subject } : {}) } }
        : { status: 'UNSUPPORTED', action: clarifyAction('UNKNOWN_INTENT') };

    case 'OPEN_SCREEN':
      return entities.app?.kind === 'open'
        ? { status: 'READY', action: { type: 'OPEN_SCREEN', screen: entities.app.screen, reason: entities.app.reason } }
        : { status: 'UNSUPPORTED', action: clarifyAction('UNKNOWN_INTENT') };

    case 'HELP':
      return { status: 'READY', action: { type: 'SHOW_HELP' } };

    case 'SMALL_TALK':
      return { status: 'READY', action: { type: 'SMALL_TALK', text: entities.question ?? '' } };

    case 'UNKNOWN':
    default: {
      // Last-chance recovery: a personal-lookup phrasing that carried no question mark
      // and no explicit verb ("আমার ওয়াইফাই পাসওয়ার্ড দাও", "my passport number") is
      // still almost certainly a request to recall a saved fact. Route it to the
      // answering pipeline (which has its own strong guardrails and will say
      // "nothing saved" if it truly finds nothing) rather than dead-ending the user.
      const q = entities.question?.trim();
      let keywords = entities.keywords ?? [];
      if (keywords.length < 3 && context.lastKeywords?.length) {
        keywords = [...new Set([...keywords, ...context.lastKeywords])].slice(0, 6);
      }
      const lookupShape =
        !!q &&
        keywords.length > 0 &&
        /(?:^|[\s("'।,])(?:আমার|আমাদের|মোর|my|our|mine)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])(?:দাও|দেখাও|বল(?:ো|েন|ুন)?|জানাও|মনে\s*করিয়ে|বের\s*কর|কোথায়|কী|কি|কত|show|tell|give|find)(?![\p{L}\p{M}])/u.test(
          q,
        );
      if (lookupShape) {
        return { status: 'READY', action: { type: 'ANSWER_QUESTION', question: q, keywords } };
      }
      return { status: 'UNSUPPORTED', action: clarifyAction('UNKNOWN_INTENT') };
    }
  }
}

/**
 * Converts deterministic local NLP output into a validated application action.
 * This layer is pure: it never opens SQLite, calls a repository, or mutates state.
 */
export function orchestrate(
  input: string,
  now = new Date(),
  context: OrchestrationContext = {},
): OrchestratorResult {
  const nlp = parseLocalNlp(input, now);
  const { status, action } = actionForIntent(nlp.intent, nlp.entities, context, input, now);
  return { status, action, nlp };
}
