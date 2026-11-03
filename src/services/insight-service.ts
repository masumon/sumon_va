// Where the modules meet.
//
// The app is supposed to behave like one mind rather than a folder of separate ledgers:
// money arriving should change what the debt page says, and an evening of unnecessary
// spending should change whether this month's repayment still looks possible.
//
// The tempting way to build that is to have the debt module import the finance module.
// It is also the way that makes the eighteenth module impossible, because by then every
// module imports every other one. So nothing here works that way.
//
// Instead there are two shared languages:
//
//   * a **month picture** — every module reports what it knows about this month's money
//     in the same four numbers, and they are simply added up. The debt module never
//     learns that a finance module exists; it reads the total.
//   * **insights** — short sentences with a severity, produced from that picture. A
//     module may add its own, but the cross-cutting ones live here, because an insight
//     that needs two modules to be true belongs to neither.
//
// A health module added next year publishes its medicine costs into the same picture and
// every warning below starts accounting for it, with no edit to this file.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshMonthKey } from '../i18n/date-time';
import type { AppLanguage } from '../i18n/date-time';
import { enabledModules, type AppModule } from '../modules/registry';
import { goalsFor, type Goal } from './goal-service';
import { formatPaisa, type Paisa } from './debt/money';

/**
 * What one module knows about a month's money.
 *
 * Every field is optional; a module reports only what it genuinely knows. A module that
 * knows nothing about money simply does not implement this and never appears here.
 */
export interface ModuleMoney {
  /** Money that came in. */
  inPaisa?: Paisa;
  /** Money that went out. */
  outPaisa?: Paisa;
  /** Of what went out, how much was on things the person marked as wants. */
  discretionaryPaisa?: Paisa;
  /** Money that has to go out this month whether or not it is convenient. */
  obligationPaisa?: Paisa;
  /** How much of that obligation has already been met. */
  obligationMetPaisa?: Paisa;
}

export interface MonthPicture {
  month: string;
  inPaisa: Paisa;
  outPaisa: Paisa;
  discretionaryPaisa: Paisa;
  obligationPaisa: Paisa;
  obligationMetPaisa: Paisa;
  /** In minus out. Negative means the month was lived beyond its means. */
  netPaisa: Paisa;
  /**
   * What is genuinely free after the month's obligations are covered.
   *
   * Income, less everything already spent, less the part of the obligations still owed.
   * This is the number a promise has to fit inside, and the number an evening out eats.
   */
  headroomPaisa: Paisa;
  goals: Goal[];
  /** Which modules contributed, so an insight can say who knows what. */
  contributors: string[];
}

export type Severity = 'GOOD' | 'INFO' | 'WATCH' | 'RISK';

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  route?: string;
  /** The modules whose numbers had to agree for this to be said. */
  from: string[];
  /** Higher shows first. Risk outranks encouragement. */
  weight: number;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { RISK: 100, WATCH: 70, INFO: 40, GOOD: 25 };

/** Add up what every enabled module reports, and read the promises in force. */
export async function buildMonthPicture(db: SQLiteDatabase, month: string): Promise<MonthPicture> {
  const modules = await enabledModules(db);
  const picture: MonthPicture = {
    month,
    inPaisa: 0,
    outPaisa: 0,
    discretionaryPaisa: 0,
    obligationPaisa: 0,
    obligationMetPaisa: 0,
    netPaisa: 0,
    headroomPaisa: 0,
    goals: [],
    contributors: [],
  };

  for (const module of modules) {
    if (!module.money) continue;
    try {
      const reported = await module.money(db, month);
      if (!reported) continue;
      picture.inPaisa += reported.inPaisa ?? 0;
      picture.outPaisa += reported.outPaisa ?? 0;
      picture.discretionaryPaisa += reported.discretionaryPaisa ?? 0;
      picture.obligationPaisa += reported.obligationPaisa ?? 0;
      picture.obligationMetPaisa += reported.obligationMetPaisa ?? 0;
      picture.contributors.push(module.id);
    } catch {
      // One module's failure must not blank the whole picture — the others still count.
    }
  }

  picture.netPaisa = picture.inPaisa - picture.outPaisa;
  const obligationLeft = Math.max(0, picture.obligationPaisa - picture.obligationMetPaisa);
  picture.headroomPaisa = picture.inPaisa - picture.outPaisa - obligationLeft;

  try {
    picture.goals = await goalsFor(db, month);
  } catch {
    picture.goals = [];
  }

  return picture;
}

// ── the cross-cutting insights ───────────────────────────────────────────────
//
// Each one needs at least two modules to be true, which is exactly why it cannot live
// inside either of them.

const bnEn = (language: AppLanguage, bn: string, en: string) => (language === 'bn' ? bn : en);

/** A share of income above which spending on wants is worth mentioning. */
const WANT_SHARE_WATCH = 0.25;
const WANT_SHARE_RISK = 0.4;

function crossCuttingInsights(picture: MonthPicture, language: AppLanguage): Insight[] {
  const out: Insight[] = [];
  const money = (paisa: Paisa) => formatPaisa(paisa, { bnDigits: language === 'bn' });
  const knows = (id: string) => picture.contributors.includes(id);

  const repayGoal = picture.goals.find((goal) => goal.kind === 'REPAY' && goal.targetPaisa);
  const target = repayGoal?.targetPaisa ?? 0;
  const met = picture.obligationMetPaisa;

  // 1. The promise against what is actually left.
  //
  // This is the sentence the whole engine exists for: it is only sayable because one
  // module knows what was promised and another knows what has been spent.
  if (target && picture.inPaisa) {
    const stillOwed = Math.max(0, target - met);
    if (stillOwed > 0 && picture.headroomPaisa < stillOwed) {
      const short = stillOwed - Math.max(0, picture.headroomPaisa);
      out.push({
        id: 'repay-at-risk',
        severity: 'RISK',
        title: bnEn(language, 'ঋণ শোধের লক্ষ্য ঝুঁকিতে', 'This month’s repayment is at risk'),
        detail: bnEn(
          language,
          `এ মাসে ${money(target)} শোধ করার কথা, দিয়েছেন ${money(met)}। খরচের পর হাতে থাকবে ${money(Math.max(0, picture.headroomPaisa))} — ${money(short)} কম পড়ছে।`,
          `You meant to repay ${money(target)} and have paid ${money(met)}. After spending, ${money(Math.max(0, picture.headroomPaisa))} is left — ${money(short)} short.`,
        ),
        route: '/finance',
        from: ['finance', 'debt'],
        weight: SEVERITY_WEIGHT.RISK + 5,
      });
    } else if (stillOwed === 0 && target > 0) {
      out.push({
        id: 'repay-met',
        severity: 'GOOD',
        title: bnEn(language, 'এ মাসের ঋণ শোধের লক্ষ্য পূরণ', 'Repayment promise kept'),
        detail: bnEn(
          language,
          `${money(target)} শোধ করার কথা ছিল, হয়েছে ${money(met)}।`,
          `You meant to repay ${money(target)} and have paid ${money(met)}.`,
        ),
        route: '/debt',
        from: ['finance', 'debt'],
        weight: SEVERITY_WEIGHT.GOOD,
      });
    }
  }

  // 2. Money arrived, and something is owed. The moment to act is now, not on the 28th.
  if (knows('finance') && knows('debt') && picture.inPaisa > 0) {
    const owedLeft = Math.max(0, picture.obligationPaisa - met);
    if (owedLeft > 0 && picture.headroomPaisa > 0) {
      const canPay = Math.min(owedLeft, picture.headroomPaisa);
      out.push({
        id: 'income-can-repay',
        severity: 'INFO',
        title: bnEn(language, 'এখনই কিছু শোধ করে দিতে পারেন', 'You could pay some of it down now'),
        detail: bnEn(
          language,
          `এ মাসে এসেছে ${money(picture.inPaisa)}। খরচ বাদে এখন ${money(canPay)} পর্যন্ত ঋণে দেওয়া যায়।`,
          `${money(picture.inPaisa)} came in this month. After spending, up to ${money(canPay)} could go against the debt.`,
        ),
        route: '/debt',
        from: ['finance', 'debt'],
        weight: SEVERITY_WEIGHT.INFO + 5,
      });
    }
  }

  // 3. Spending on wants, measured against income rather than against a fixed figure —
  //    ৳2,000 of eating out means something entirely different on two different salaries.
  if (picture.inPaisa > 0 && picture.discretionaryPaisa > 0) {
    const share = picture.discretionaryPaisa / picture.inPaisa;
    if (share >= WANT_SHARE_RISK) {
      out.push({
        id: 'wants-high',
        severity: 'RISK',
        title: bnEn(language, 'শখের খরচ অনেক বেড়েছে', 'Spending on wants has climbed'),
        detail: bnEn(
          language,
          `আয়ের ${Math.round(share * 100)}% গেছে শখের খাতে (${money(picture.discretionaryPaisa)})। এখানে কমালে ঋণ শোধ সহজ হবে।`,
          `${Math.round(share * 100)}% of what came in went on wants (${money(picture.discretionaryPaisa)}). Trimming here is what makes the repayment possible.`,
        ),
        route: '/finance',
        from: ['finance'],
        weight: SEVERITY_WEIGHT.RISK,
      });
    } else if (share >= WANT_SHARE_WATCH) {
      out.push({
        id: 'wants-watch',
        severity: 'WATCH',
        title: bnEn(language, 'শখের খরচ নজরে রাখুন', 'Keep an eye on the wants'),
        detail: bnEn(
          language,
          `আয়ের ${Math.round(share * 100)}% শখের খাতে গেছে (${money(picture.discretionaryPaisa)})।`,
          `${Math.round(share * 100)}% of income has gone on wants (${money(picture.discretionaryPaisa)}).`,
        ),
        route: '/finance',
        from: ['finance'],
        weight: SEVERITY_WEIGHT.WATCH,
      });
    }
  }

  // 4. Living beyond the month. Said plainly and only once, without a lecture attached.
  if (picture.inPaisa > 0 && picture.netPaisa < 0) {
    out.push({
      id: 'over-month',
      severity: 'WATCH',
      title: bnEn(language, 'এ মাসে আয়ের চেয়ে খরচ বেশি', 'Spending has passed income'),
      detail: bnEn(
        language,
        `আয় ${money(picture.inPaisa)}, খরচ ${money(picture.outPaisa)} — ${money(-picture.netPaisa)} বেশি।`,
        `In ${money(picture.inPaisa)}, out ${money(picture.outPaisa)} — ${money(-picture.netPaisa)} over.`,
      ),
      route: '/finance',
      from: ['finance'],
      weight: SEVERITY_WEIGHT.WATCH + 8,
    });
  }

  // 5. A month that went well, which is worth saying — a ledger that only ever warns
  //    stops being read.
  if (picture.inPaisa > 0 && picture.netPaisa > 0 && !out.some((i) => i.severity === 'RISK')) {
    out.push({
      id: 'month-healthy',
      severity: 'GOOD',
      title: bnEn(language, 'মাসটা ভালো যাচ্ছে', 'The month is going well'),
      detail: bnEn(
        language,
        `খরচের পর ${money(picture.netPaisa)} রয়ে গেছে।`,
        `${money(picture.netPaisa)} is still in hand after spending.`,
      ),
      route: '/finance',
      from: ['finance'],
      weight: SEVERITY_WEIGHT.GOOD,
    });
  }

  return out;
}

/**
 * Everything worth telling the user about this month, best-first.
 *
 * Modules get the finished picture and may add their own sentences; anything that needed
 * two modules to be true has already been added above.
 */
export async function collectInsights(
  db: SQLiteDatabase,
  language: AppLanguage,
  month: string,
): Promise<{ picture: MonthPicture; insights: Insight[] }> {
  const picture = await buildMonthPicture(db, month);
  const insights = crossCuttingInsights(picture, language);

  let modules: AppModule[] = [];
  try { modules = await enabledModules(db); } catch { modules = []; }

  for (const module of modules) {
    if (!module.insights) continue;
    try {
      insights.push(...(await module.insights(db, picture, language)));
    } catch {
      // A module that cannot form an opinion simply has none.
    }
  }

  insights.sort((a, b) => b.weight - a.weight);
  return { picture, insights };
}

/** The same sentences, flattened for the assistant to quote. */
export async function insightFacts(db: SQLiteDatabase, language: AppLanguage, month: string): Promise<string[]> {
  const { insights } = await collectInsights(db, language, month);
  return insights.slice(0, 4).map((insight) => `${insight.title} — ${insight.detail}`);
}

// ── telling the user before the month is lost ────────────────────────────────
//
// A warning that only exists inside the app is a warning nobody sees until they happen to
// open it, which is usually after the money has gone. So the worst insight of the month
// is also allowed to ring once.
//
// Once. Not once a day: a phone that nags about money every morning gets its
// notifications turned off, and then the genuinely urgent one never arrives either. The
// preference below records which month's warning has already been given.


const WARNED_KEY = 'insight.warnedMonth';

/**
 * Ring once, this month, if something has gone genuinely wrong.
 *
 * Checks the permission rather than asking for it — this runs on launch, and a permission
 * dialog raised without a reason on screen is one the user denies for good.
 */
export async function warnIfMonthAtRisk(
  db: SQLiteDatabase,
  language: AppLanguage,
  schedule: (title: string, body: string) => Promise<unknown>,
  month = bangladeshMonthKey(),
): Promise<boolean> {
  try {
    // Imported here rather than at the top so this file stays free of native modules:
    // the picture and the insights are pure arithmetic, and anything that can run in a
    // plain Node test should not drag expo-notifications in behind it.
    const { hasNotificationPermission } = await import('./notification.service');
    if (!(await hasNotificationPermission())) return false;

    const already = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?', WARNED_KEY,
    );
    if (already?.value === month) return false;

    const { insights } = await collectInsights(db, language, month);
    const worst = insights.find((insight) => insight.severity === 'RISK');
    if (!worst) return false;

    await schedule(worst.title, worst.detail);
    await db.runAsync(
      'INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', WARNED_KEY, month,
    );
    return true;
  } catch {
    return false;
  }
}
