// What a module is, and how it joins the app.
//
// The app is meant to hold a whole life, which means modules will keep arriving: health,
// income, study, documents. Each one needs the same handful of things — a place in the
// navigation, a line on Home when it has something to say today, its settings inside
// Settings, its reminders inside Reminders, its records in search, its facts available to
// the assistant, and a switch to turn it off for someone who does not need it.
//
// The wrong way to give it those is to edit seven files per module. That is how the debt
// module ended up with its reminder switch buried in its own tools screen, where nobody
// looking for reminder settings would ever find it.
//
// So a module declares itself once, here, and the seven places read the declaration. A
// module added next year touches its own folder and one line of `modules/index.ts`.
//
// Nothing in this file imports a module. Modules import this.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshMonthKey } from '../i18n/date-time';
import type { AppLanguage } from '../i18n/date-time';
import type { Insight, ModuleMoney, MonthPicture } from '../services/insight-service';
import type { AgendaItem } from '../services/agenda-service';
import type { TrashedItem } from '../services/trash-registry';
import type { AccentName, IconName } from './types';

/** A one-line summary a module can show on Home when it has something to say today. */
export interface HomeLine {
  /** Short label — "Overdue debt", "Medicine due". */
  label: string;
  /** The figure or fact itself. */
  value: string;
  hint?: string;
  /** Where tapping it goes. */
  route: string;
  /** The glyph beside it. Home used to hard-code a wallet, which was wrong for anything
   *  that is not about money — a module says what it looks like. */
  icon?: IconName;
  /** Higher shows first. Something overdue outranks something merely upcoming. */
  weight: number;
  tone?: AccentName;
}

/** One setting a module contributes to the app's Settings screen. */
export type ModuleSettingKind = 'TOGGLE' | 'CHOICE' | 'AMOUNT';

export interface ModuleSetting {
  key: string;
  kind: ModuleSettingKind;
  label: (language: AppLanguage) => string;
  hint?: (language: AppLanguage) => string;
  /** For CHOICE: the options, already labelled. */
  options?: (language: AppLanguage) => { value: string; label: string }[];
  read: (db: SQLiteDatabase) => Promise<string | null>;
  write: (db: SQLiteDatabase, value: string) => Promise<void>;
}

/** A reminder a module has scheduled, as the Reminders screen needs to show it. */
export interface ModuleReminder {
  id: string;
  title: string;
  body?: string;
  /** ISO instant it will fire. */
  at: string;
  route?: string;
}

export interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  route: string;
  icon?: IconName;
  tone?: AccentName;
  /** Higher sorts first within a module's own hits. */
  weight?: number;
}

export interface AppModule {
  /** Stable key. Used for the on/off preference, so never rename it once shipped. */
  id: string;
  /** Where the module lives. */
  route: string;
  icon: IconName;
  activeIcon?: IconName;
  tone: AccentName;
  title: (language: AppLanguage) => string;

  /** Shown in the "which parts of your life?" chooser. */
  description?: (language: AppLanguage) => string;
  /**
   * Whether a fresh install starts with this module on. A student should not have to turn
   * off four modules before the app is theirs; most people should not meet a debt ledger
   * on day one either.
   */
  defaultEnabled: boolean;
  /** Modules the user cannot switch off, because the app makes no sense without them. */
  essential?: boolean;

  /** Appears in the bottom navigation when enabled. Space is limited; not every module does. */
  inPrimaryNav?: boolean;

  /** Today's one line, or null when the module has nothing worth saying. */
  homeLine?: (db: SQLiteDatabase, language: AppLanguage) => Promise<HomeLine | null>;
  /** Settings this module owns — rendered inside the app's Settings screen. */
  settings?: (language: AppLanguage) => ModuleSetting[];
  /** Reminders this module has scheduled, for the app's Reminders screen. */
  reminders?: (db: SQLiteDatabase, language: AppLanguage) => Promise<ModuleReminder[]>;
  /** Records matching a query, for the app's search. */
  search?: (db: SQLiteDatabase, query: string, language: AppLanguage) => Promise<SearchHit[]>;
  /** Short plain sentences the assistant may quote. Keep them few; they cost tokens. */
  facts?: (db: SQLiteDatabase, language: AppLanguage) => Promise<string[]>;

  /**
   * What this module knows about one month's money.
   *
   * Reported in the four shared numbers so the app can add every module's money together
   * without any module importing another. A module with nothing to say about money simply
   * leaves this out. See `services/insight-service`.
   */
  money?: (db: SQLiteDatabase, month: string) => Promise<ModuleMoney | null>;

  /**
   * This module's opinion, given the finished cross-module picture.
   *
   * The picture is already the sum of everybody's numbers, so a module can react to money
   * it knows nothing about — which is what stops the debt module from having to import
   * the income module, and the income module from having to know a debt exists.
   */
  insights?: (db: SQLiteDatabase, picture: MonthPicture, language: AppLanguage) => Promise<Insight[]>;

  /**
   * What this module has on, between two days.
   *
   * "What is happening on the tenth" is one question, and it used to have four answers in
   * four screens. A module reports its own days here and the calendar adds them up, which
   * is the same arrangement as `money` — nobody imports anybody.
   */
  agenda?: (db: SQLiteDatabase, language: AppLanguage, from: string, to: string) => Promise<AgendaItem[]>;

  /**
   * Things this module has soft-deleted, so Trash can offer them back.
   *
   * Without this a module's deletions are invisible and unrecoverable: the row is marked
   * deleted and no screen will ever show it again. Trash used to know about tasks and
   * memories by name, which meant every new module silently lost that safety net.
   */
  trash?: (db: SQLiteDatabase, language: AppLanguage) => Promise<TrashedItem[]>;
  /**
   * Words that suggest a question is about this module — in both languages.
   *
   * Without this the assistant would paste every module's facts into every answer, which
   * costs tokens and buries the relevant line. A module that declares none is treated as
   * always relevant, which is the right default for something like a diary.
   */
  factKeywords?: () => string[];
}

// ── the register ──────────────────────────────────────────────────────────────

const modules = new Map<string, AppModule>();

/** Add a module. Called once per module from `modules/index.ts`. */
export function registerModule(module: AppModule): void {
  modules.set(module.id, module);
  forgetModuleState();
}

export function allModules(): AppModule[] {
  return [...modules.values()];
}

export function getModule(id: string): AppModule | undefined {
  return modules.get(id);
}

// ── on and off ────────────────────────────────────────────────────────────────

const PREF_PREFIX = 'module.enabled.';

/**
 * Whether a module is on for this user.
 *
 * Read from `app_preferences` so the choice survives a restart and rides in the backup.
 * An essential module is always on; an unanswered one falls back to its default, so a
 * fresh install is useful before the user has chosen anything.
 */
export async function isModuleEnabled(db: SQLiteDatabase, module: AppModule): Promise<boolean> {
  if (module.essential) return true;
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?', `${PREF_PREFIX}${module.id}`,
    );
    if (!row) return module.defaultEnabled;
    return row.value === '1';
  } catch {
    return module.defaultEnabled;
  }
}

export async function setModuleEnabled(db: SQLiteDatabase, moduleId: string, enabled: boolean): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    `${PREF_PREFIX}${moduleId}`, enabled ? '1' : '0',
  );
  forgetModuleState();
}

// The answer barely ever changes, and it is asked constantly.
//
// Opening Home used to run this three times — once for the module lines, once inside the
// insight engine, once for the shortcut grid — and each run issued one query per module.
// With five modules that is fifteen round trips to SQLite before a single figure is
// computed, on every focus, including every time the user comes back from another screen.
//
// So the whole set is read in one query and held briefly. The window is short on purpose:
// long enough to collapse the burst of calls a single screen makes, short enough that
// turning a module off in Settings is visible immediately — and `setModuleEnabled` clears
// it outright, so the only thing the cache can ever be stale about is nothing.
let cache: { at: number; ids: Set<string> } | null = null;
const CACHE_MS = 1500;

/** Forget what was cached. Called whenever the answer could have changed. */
export function forgetModuleState(): void {
  cache = null;
}

async function enabledIds(db: SQLiteDatabase): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;

  // Deliberately the same per-module question `isModuleEnabled` asks, rather than one
  // clever query over the preference table. The saving that matters is not doing the work
  // five times a second; rewriting the SQL as well would only add a second definition of
  // "is this module on" that could drift from the first.
  const ids = new Set<string>();
  for (const module of modules.values()) {
    if (await isModuleEnabled(db, module)) ids.add(module.id);
  }

  cache = { at: Date.now(), ids };
  return ids;
}

/** The modules this user actually has on, in registration order. */
export async function enabledModules(db: SQLiteDatabase): Promise<AppModule[]> {
  const ids = await enabledIds(db);
  return [...modules.values()].filter((module) => ids.has(module.id));
}

// ── what the shared screens ask for ───────────────────────────────────────────
//
// Each of these gathers from every enabled module and never fails the whole screen for
// one module's error: a health module that throws must not blank the Home screen.

async function gather<T>(
  db: SQLiteDatabase,
  pick: (m: AppModule) => ((db: SQLiteDatabase, ...rest: never[]) => Promise<T>) | undefined,
  run: (fn: NonNullable<ReturnType<typeof pick>>, m: AppModule) => Promise<T>,
): Promise<{ module: AppModule; value: T }[]> {
  const out: { module: AppModule; value: T }[] = [];
  for (const module of await enabledModules(db)) {
    const fn = pick(module);
    if (!fn) continue;
    try {
      out.push({ module, value: await run(fn, module) });
    } catch {
      // One module's failure is its own; the screen still shows the others.
    }
  }
  return out;
}

/** Every module's line for Home, most urgent first. */
export async function collectHomeLines(db: SQLiteDatabase, language: AppLanguage): Promise<HomeLine[]> {
  const results = await gather<HomeLine | null>(db, (m) => m.homeLine as never, (fn) => (fn as never as (d: SQLiteDatabase, l: AppLanguage) => Promise<HomeLine | null>)(db, language));
  return results
    .map((r) => r.value)
    .filter((line): line is HomeLine => line !== null)
    .sort((a, b) => b.weight - a.weight);
}

/** Every module's settings, grouped by the module they belong to. */
export function collectSettings(language: AppLanguage, forModules: AppModule[]): { module: AppModule; settings: ModuleSetting[] }[] {
  return forModules
    .map((module) => ({ module, settings: module.settings?.(language) ?? [] }))
    .filter((group) => group.settings.length > 0);
}

/** Every module's scheduled reminders, soonest first. */
export async function collectReminders(db: SQLiteDatabase, language: AppLanguage): Promise<{ module: AppModule; reminder: ModuleReminder }[]> {
  const results = await gather<ModuleReminder[]>(db, (m) => m.reminders as never, (fn) => (fn as never as (d: SQLiteDatabase, l: AppLanguage) => Promise<ModuleReminder[]>)(db, language));
  return results
    .flatMap(({ module, value }) => value.map((reminder) => ({ module, reminder })))
    .sort((a, b) => a.reminder.at.localeCompare(b.reminder.at));
}

/** Every module's search hits for one query. */
export async function collectSearchHits(db: SQLiteDatabase, query: string, language: AppLanguage): Promise<{ module: AppModule; hits: SearchHit[] }[]> {
  const q = query.trim();
  if (!q) return [];
  const results = await gather<SearchHit[]>(db, (m) => m.search as never, (fn) => (fn as never as (d: SQLiteDatabase, s: string, l: AppLanguage) => Promise<SearchHit[]>)(db, q, language));
  return results
    .map(({ module, value }) => ({ module, hits: [...value].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)) }))
    .filter((r) => r.hits.length > 0);
}

/**
 * Short sentences from every module, for the assistant to draw on.
 *
 * Pass the question and only the modules whose keywords it touches contribute — plus any
 * module that declared no keywords, which is how a module says "I am always relevant".
 * Called without a question, every enabled module contributes.
 */
export async function collectFacts(db: SQLiteDatabase, language: AppLanguage, question?: string): Promise<string[]> {
  const q = question?.toLowerCase().trim();
  const out: string[] = [];
  for (const module of await enabledModules(db)) {
    if (!module.facts) continue;
    if (q) {
      const keywords = module.factKeywords?.() ?? [];
      if (keywords.length && !keywords.some((w) => q.includes(w.toLowerCase()))) continue;
    }
    try {
      out.push(...(await module.facts(db, language)));
    } catch {
      // One module's failure is its own.
    }
  }

  // And the cross-module sentences, which belong to no module and so would otherwise be
  // invisible to the assistant. Put first: a warning outranks a figure.
  try {
    const { insightFacts } = await import('../services/insight-service');
    const composed = await insightFacts(db, language, bangladeshMonthKey());
    out.unshift(...composed);
  } catch {
    // The picture could not be built; the per-module facts still stand.
  }

  return out;
}

/** Wipe the register — tests only. */
export function resetModulesForTest(): void {
  forgetModuleState();
  modules.clear();
}

// Re-exported so a module declaration needs one import, not three.
export type { Insight, ModuleMoney, MonthPicture } from '../services/insight-service';
export type { AgendaItem, AgendaDay } from '../services/agenda-service';
export type { TrashedItem } from '../services/trash-registry';
