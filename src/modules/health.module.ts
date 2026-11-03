// স্বাস্থ্য, declared.
//
// The engine underneath this was written months ago and had no door: `measurement-service`
// already stores readings as integers in their smallest unit, tracks targets with a
// direction, and computes whether a number is improving or getting worse. Weight going
// down and savings going up are the same arithmetic, which is why উন্নতি and অবনতি never
// needed separate code.
//
// What was missing was a module declaration, so the app could show it. That is all this
// file is: the metrics people here actually track, and how each one reads.

import { latestMeasurement, listMetrics, progress, SELF } from '../services/measurement-service';
import type { SQLiteDatabase } from 'expo-sqlite';
import { asciiDigitsToBengali, formatPaisa } from '../services/debt/money';
import { bangladeshDateKey, zonedInstant } from '../i18n/date-time';
import { registerTrashExpiryTable, registerTrashHandlers, registerTrashTable } from '../services/trash-registry';
import { deleteAttachmentFiles } from '../services/attachment-service';
import { atomic } from '../database/atomic';
import {
  ensureDosesForDay, healthCategoryName, listMedicines, listTests, listVisits,
  medicalSpend, missedDoses, nextDose, upcomingHealth,
} from '../services/health-service';
import { registerModule, type AppModule, type SearchHit } from './registry';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

// Module settings are rows in the app's own preference table, not a table of this
// module's — which is what lets Settings render them without knowing what health is.
async function getPreference(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', key);
  return row?.value ?? null;
}
async function setPreference(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', key, value);
}
const digits = (value: string | number, bn: boolean) => (bn ? asciiDigitsToBengali(String(value)) : String(value));

/**
 * What a metric is called, what it is measured in, and how to say the number.
 *
 * Stored in the smallest whole unit so nothing is ever a fraction: grams not kilograms,
 * millimetres of mercury as they already are, and blood sugar in hundredths so 5.6 mmol/L
 * is the integer 560. Anyone can record a metric that is not on this list — these are the
 * ones the app knows how to phrase.
 */
export interface MetricShape {
  metric: string;
  unit: string;
  bn: string;
  en: string;
  /** Smallest-unit value → what a person would say. */
  say: (value: number, bn: boolean) => string;
  /** Which direction counts as getting better, when a target is set. */
  better: 'UP' | 'DOWN';
}

export const METRICS: MetricShape[] = [
  {
    metric: 'WEIGHT', unit: 'g', bn: 'ওজন', en: 'Weight', better: 'DOWN',
    say: (value, bn) => `${digits((value / 1000).toFixed(1), bn)} ${bn ? 'কেজি' : 'kg'}`,
  },
  {
    metric: 'BP_SYSTOLIC', unit: 'mmHg', bn: 'রক্তচাপ (উপরের)', en: 'Blood pressure (upper)', better: 'DOWN',
    say: (value, bn) => `${digits(value, bn)} ${bn ? 'মি.মি.' : 'mmHg'}`,
  },
  {
    metric: 'BP_DIASTOLIC', unit: 'mmHg', bn: 'রক্তচাপ (নিচের)', en: 'Blood pressure (lower)', better: 'DOWN',
    say: (value, bn) => `${digits(value, bn)} ${bn ? 'মি.মি.' : 'mmHg'}`,
  },
  {
    metric: 'BLOOD_SUGAR', unit: 'mmol/L×100', bn: 'রক্তে চিনি', en: 'Blood sugar', better: 'DOWN',
    say: (value, bn) => `${digits((value / 100).toFixed(1), bn)} ${bn ? 'মিলিমোল' : 'mmol/L'}`,
  },
  {
    metric: 'STEPS', unit: 'steps', bn: 'হাঁটা', en: 'Steps', better: 'UP',
    say: (value, bn) => `${digits(value, bn)} ${bn ? 'কদম' : 'steps'}`,
  },
  {
    metric: 'SLEEP', unit: 'min', bn: 'ঘুম', en: 'Sleep', better: 'UP',
    say: (value, bn) => `${digits(Math.floor(value / 60), bn)} ${bn ? 'ঘণ্টা' : 'h'} ${digits(value % 60, bn)} ${bn ? 'মিনিট' : 'm'}`,
  },
];

export const metricShape = (metric: string): MetricShape | undefined =>
  METRICS.find((shape) => shape.metric === metric);

/** Nine in the morning on a given day — when a person can actually act on a reminder. */
const dhakaMorning = (dayKey: string): string => zonedInstant(dayKey, '09:00');

export const healthModule: AppModule = {
  id: 'health',
  route: '/health',
  icon: 'heart-pulse',
  tone: 'red',
  // On by default now that it carries medicine times. A reminder that only works after
  // you find a switch is not a reminder — and this is the one module whose whole job is
  // to speak up at a fixed hour. Still one tap to turn off in আরও → মডিউল.
  defaultEnabled: true,
  title: (language) => (language === 'bn' ? 'স্বাস্থ্য' : 'Health'),
  description: (language) =>
    language === 'bn'
      ? 'ওষুধের সময়, ডাক্তার, পরীক্ষা, চিকিৎসার খরচ — আর ওজন-প্রেসার-চিনির মাপ।'
      : 'Medicine times, doctors, tests, medical costs — and weight, pressure, sugar.',

  // ── Home ───────────────────────────────────────────────────────────────────
  //
  // The one reading worth putting on Home is a number heading the wrong way. A tracker
  // that reports every figure every day becomes wallpaper; one that speaks up when
  // something is sliding gets read.
  async homeLine(db, language) {
    const bn = language === 'bn';

    // Medicine outranks every reading, because it is the only thing here with a deadline.
    // A blood pressure figure can be looked at this evening; a dose cannot.
    const missed = await missedDoses(db, 1).catch(() => []);
    if (missed.length) {
      return {
        label: bn ? 'ওষুধ বাদ পড়েছে' : 'Missed medicine',
        value: bn ? `${bnNum(missed.length)}টি ডোজ` : `${missed.length} doses`,
        hint: missed[0]?.medicineName ?? undefined,
        route: '/health', icon: 'pill', weight: 88, tone: 'red',
      };
    }
    const next = await nextDose(db).catch(() => null);
    if (next) {
      const at = new Date(next.dueAt);
      const today = bangladeshDateKey(at) === bangladeshDateKey(new Date());
      return {
        label: bn ? 'পরের ওষুধ' : 'Next medicine',
        value: next.medicineName ?? (bn ? 'ওষুধ' : 'Medicine'),
        hint: today
          ? new Intl.DateTimeFormat(bn ? 'bn-BD' : 'en-BD', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' }).format(at)
          : (bn ? 'পরে' : 'later'),
        route: '/health', icon: 'pill', weight: 62, tone: 'blue',
      };
    }

    const metrics = await listMetrics(db, SELF);
    if (!metrics.length) return null;

    for (const { metric } of metrics) {
      const shape = metricShape(metric);
      const state = await progress(db, metric, SELF, undefined, shape?.better).catch(() => null);
      if (!state || state.trend !== 'DECLINING') continue;
      return {
        label: shape ? (bn ? shape.bn : shape.en) : metric,
        value: shape ? shape.say(state.currentValue, bn) : String(state.currentValue),
        hint: bn ? 'খারাপের দিকে যাচ্ছে' : 'moving the wrong way',
        route: '/health',
        icon: 'heart-pulse',
        weight: 66,
        tone: 'orange',
      };
    }

    // Nothing sliding: report the most recent reading quietly, so the module is still
    // visible to someone who is using it.
    const first = metrics[0];
    if (!first) return null;
    const latest = await latestMeasurement(db, first.metric, SELF);
    if (!latest) return null;
    const shape = metricShape(first.metric);
    return {
      label: shape ? (bn ? shape.bn : shape.en) : first.metric,
      value: shape ? shape.say(latest.value, bn) : String(latest.value),
      route: '/health',
      icon: 'heart-pulse',
      weight: 22,
      tone: 'blue',
    };
  },

  // ── what the assistant may quote ───────────────────────────────────────────
  async facts(db, language) {
    const bn = language === 'bn';
    const metrics = await listMetrics(db, SELF);
    const out: string[] = [];
    for (const { metric } of metrics.slice(0, 4)) {
      const shape = metricShape(metric);
      const state = await progress(db, metric, SELF, undefined, shape?.better).catch(() => null);
      if (!state) continue;
      const name = shape ? (bn ? shape.bn : shape.en) : metric;
      const value = shape ? shape.say(state.currentValue, bn) : String(state.currentValue);
      const trend = state.trend === 'IMPROVING'
        ? (bn ? 'ভালো হচ্ছে' : 'improving')
        : state.trend === 'DECLINING' ? (bn ? 'খারাপ হচ্ছে' : 'getting worse') : (bn ? 'একই আছে' : 'flat');
      out.push(bn ? `${name} এখন ${value} — ${trend}।` : `${name} is ${value} — ${trend}.`);
    }
    return out;
  },

  // ── settings, which live in Settings ──────────────────────────────────────
  settings: (language) => {
    const bn = language === 'bn';
    return [
      {
        key: 'health.remindHour',
        kind: 'CHOICE',
        label: () => (bn ? 'মাপ নেওয়ার কথা মনে করাবে' : 'Remind me to take a reading'),
        hint: () => (bn
          ? 'রক্তচাপ বা ওজন — যে সময়ে মাপলে হিসাব মেলে, সেই সময়টাই বেছে নিন।'
          : 'Readings only compare if they are taken at the same time of day.'),
        options: () => [
          { value: '0', label: bn ? 'মনে করাবে না' : 'Never' },
          { value: '7', label: bn ? 'সকাল ৭টা' : '7 AM' },
          { value: '9', label: bn ? 'সকাল ৯টা' : '9 AM' },
          { value: '21', label: bn ? 'রাত ৯টা' : '9 PM' },
        ],
        read: async (db) => (await getPreference(db, 'health.remindHour')) ?? '0',
        write: async (db, value) => { await setPreference(db, 'health.remindHour', value); },
      },
    ];
  },

  // ── reminders: medicine, and the reading itself ───────────────────────────
  //
  // A measurement only means something next to the last one taken the same way, so the
  // reminder carries the hour the user chose rather than firing whenever the app happens
  // to open. Medicine is the same shape — a thing that has to happen at an hour — which
  // is why it is a metric here rather than a separate table.
  async reminders(db, language) {
    const bn = language === 'bn';
    const out = [];
    const nowMs = Date.now();

    // ── medicine, for the next two days ──────────────────────────────────────
    //
    // Two days rather than the whole course: the scheduler re-reads this every time the
    // app opens, and a phone will only hold so many pending alarms. Anything further out
    // is not forgotten, it simply has not been armed yet.
    const today = new Date();
    for (let offset = 0; offset < 2; offset += 1) {
      const day = new Date(today);
      day.setDate(day.getDate() + offset);
      const dayKey = bangladeshDateKey(day);
      for (const dose of await ensureDosesForDay(db, dayKey)) {
        if (dose.status === 'TAKEN' || dose.status === 'SKIPPED') continue;
        const at = dose.snoozeUntil ?? dose.dueAt;
        if (new Date(at).getTime() <= nowMs) continue;
        out.push({
          id: `health:dose:${dose.id}`,
          title: bn ? `${dose.medicineName} খাওয়ার সময়` : `Time for ${dose.medicineName}`,
          body: bn ? 'খেয়ে নিয়ে টিক দিন।' : 'Take it, then mark it done.',
          at, route: '/health',
        });
      }
    }

    // ── refills, follow-ups and repeat tests ─────────────────────────────────
    //
    // Fired at nine in the morning on the day, which is when someone can act on them —
    // a pharmacy is not open at midnight, and a reminder nobody can act on is noise.
    for (const item of await upcomingHealth(db, bn ? 'bn' : 'en', 30)) {
      const at = dhakaMorning(item.dayKey);
      if (new Date(at).getTime() <= nowMs) continue;
      out.push({
        id: `health:${item.id}`,
        title: item.title,
        body: item.kind === 'REFILL'
          ? (bn ? 'ওষুধ ফুরিয়ে আসছে — কিনে রাখুন।' : 'This is running out — buy more.')
          : (bn ? 'আজকের দিন।' : 'It is today.'),
        at, route: item.route,
      });
    }

    const hour = Number((await getPreference(db, 'health.remindHour')) ?? '0');
    if (!hour) return out;

    const metrics = await listMetrics(db, SELF);
    if (!metrics.length) return out;

    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
    // Past that hour today, the next one is tomorrow.
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);

    for (const { metric } of metrics.slice(0, 3)) {
      const shape = metricShape(metric);
      const name = shape ? (bn ? shape.bn : shape.en) : metric;
      out.push({
        id: `health:${metric}`,
        title: bn ? `${name} মেপে নিন` : `Take your ${name.toLowerCase()} reading`,
        body: bn
          ? 'একই সময়ে মাপলে আগের মাপের সাথে মেলে।'
          : 'Taken at the same hour, it compares with the last one.',
        at: at.toISOString(),
        route: '/health',
      });
    }
    return out;
  },

  // ── search ────────────────────────────────────────────────────────────────
  async search(db, query, language) {
    const bn = language === 'bn';
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const hits: SearchHit[] = [];

    const matches = (value?: string | null) => Boolean(value && value.toLowerCase().includes(term));
    for (const medicine of await listMedicines(db, { includeArchived: true })) {
      if (!matches(medicine.name) && !matches(medicine.reason) && !matches(medicine.doctor)) continue;
      hits.push({
        id: `health-med-${medicine.id}`, title: medicine.name,
        subtitle: medicine.reason ?? (bn ? 'ওষুধ' : 'Medicine'),
        route: `/health/medicine/${medicine.id}`, icon: 'pill' as const, tone: 'red' as const, weight: 60,
      });
    }
    for (const visit of await listVisits(db, { limit: 200 })) {
      if (!matches(visit.doctor) && !matches(visit.specialty) && !matches(visit.diagnosis) && !matches(visit.reason)) continue;
      hits.push({
        id: `health-visit-${visit.id}`, title: visit.doctor,
        subtitle: visit.specialty ?? visit.visitedOn,
        route: '/health/visits', icon: 'stethoscope' as const, tone: 'red' as const, weight: 50,
      });
    }
    for (const test of await listTests(db, { limit: 200 })) {
      if (!matches(test.name) && !matches(test.lab) && !matches(test.result)) continue;
      hits.push({
        id: `health-test-${test.id}`, title: test.name,
        subtitle: test.lab ?? test.testedOn,
        route: '/health/tests', icon: 'test-tube' as const, tone: 'red' as const, weight: 45,
      });
    }

    const metrics = await listMetrics(db, SELF);
    return hits.concat(metrics
      .filter(({ metric }) => {
        const shape = metricShape(metric);
        if (!shape) return metric.toLowerCase().includes(term);
        return shape.bn.includes(query.trim()) || shape.en.toLowerCase().includes(term);
      })
      .map(({ metric, count }) => {
        const shape = metricShape(metric);
        return {
          id: `health-${metric}`,
          title: shape ? (bn ? shape.bn : shape.en) : metric,
          subtitle: bn ? `${digits(count, true)}টি রেকর্ড` : `${bnNum(count)} readings`,
          route: '/health',
          icon: 'heart-pulse' as const,
          tone: 'red' as const,
          weight: 30,
        };
      }));
  },

  // ── the money picture ──────────────────────────────────────────────────────
  //
  // Health reports no `inPaisa`/`outPaisa`. It must not: those medical expenses are
  // already `fin_entries` rows, so the income-and-spending module has counted every one
  // of them. Reporting them here too is precisely how the same 2,000 taka would be spent
  // twice. What health can say that nobody else can is that the spending was *medical* —
  // an obligation you do not get to postpone — so it reports it as one.
  async money(db, month) {
    const spend = await medicalSpend(db, `${month}-01`, `${month}-31`);
    if (!spend.totalPaisa) return null;
    return { obligationPaisa: spend.totalPaisa, obligationMetPaisa: spend.totalPaisa };
  },

  async insights(db, picture, language) {
    const bn = language === 'bn';
    const out = [];
    const spend = await medicalSpend(db, `${picture.month}-01`, `${picture.month}-31`);
    if (spend.totalPaisa > 0) {
      const money = (p: number) => formatPaisa(p, { bnDigits: bn });
      const top = spend.byCategory[0];
      out.push({
        id: 'health-spend',
        severity: 'INFO' as const,
        title: bn ? 'এই মাসে চিকিৎসার খরচ' : 'Medical spending this month',
        detail: bn
          ? `${money(spend.totalPaisa)}${top ? ` — সবচেয়ে বেশি ${top.category}য়` : ''}। এটি মাসের মোট ব্যয়ের ভেতরেই আছে, আলাদা নয়।`
          : `${money(spend.totalPaisa)}${top ? `, mostly ${healthCategoryName(top.category, false).toLowerCase()}` : ''}. It is inside the month's spending, not on top of it.`,
        from: ['health', 'finance'],
        weight: 40,
        route: '/health/expenses',
      });
    }
    const missed = await missedDoses(db, 7);
    if (missed.length >= 3) {
      out.push({
        id: 'health-missed',
        severity: 'WATCH' as const,
        title: bn ? 'ওষুধ বাদ পড়ছে' : 'Doses are being missed',
        detail: bn
          ? `গত সপ্তাহে ${bnNum(missed.length)}টি ডোজে টিক পড়েনি।`
          : `${missed.length} doses went unmarked in the last week.`,
        from: ['health'],
        weight: 70,
        route: '/health',
      });
    }
    return out;
  },

  // ── the day view ───────────────────────────────────────────────────────────
  async agenda(db, language, from, to) {
    const bn = language === 'bn';
    const items = [];

    for (const item of await upcomingHealth(db, bn ? 'bn' : 'en', 120)) {
      if (item.dayKey < from || item.dayKey > to) continue;
      items.push({
        id: `health-${item.id}`, module: 'health', kind: 'REMINDER' as const,
        day: item.dayKey, title: item.title, route: item.route,
        weight: item.kind === 'FOLLOW_UP' ? 70 : 45,
      });
    }

    // Today's doses, so a day in the agenda is honest about what still has to happen.
    const today = bangladeshDateKey(new Date());
    if (today >= from && today <= to) {
      for (const dose of await ensureDosesForDay(db, today)) {
        items.push({
          id: `health-dose-${dose.id}`, module: 'health', kind: 'REMINDER' as const,
          day: dose.dayKey, at: dose.dueAt, route: '/health',
          title: bn ? `${dose.medicineName} খাওয়ার সময়` : `Take ${dose.medicineName}`,
          weight: dose.status === 'PENDING' ? 80 : 20,
          done: dose.status === 'TAKEN' || dose.status === 'SKIPPED',
        });
      }
    }
    return items;
  },

  // ── the bin ────────────────────────────────────────────────────────────────
  async trash(db, language) {
    const bn = language === 'bn';
    const out = [];
    const rows = await db.getAllAsync<{ id: string; name: string; deleted_at: string; sort: string }>(
      `SELECT id, name, deleted_at, 'med' AS sort FROM hl_medicines WHERE deleted_at IS NOT NULL
       UNION ALL SELECT id, doctor AS name, deleted_at, 'visit' FROM hl_visits WHERE deleted_at IS NOT NULL
       UNION ALL SELECT id, name, deleted_at, 'test' FROM hl_tests WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC LIMIT 60`,
    );
    for (const row of rows) {
      out.push({
        id: row.id, module: 'health', title: row.name, deletedAt: row.deleted_at,
        icon: (row.sort === 'med' ? 'pill' : row.sort === 'visit' ? 'stethoscope' : 'test-tube') as never,
        subtitle: row.sort === 'med' ? (bn ? 'ওষুধ' : 'Medicine')
          : row.sort === 'visit' ? (bn ? 'ডাক্তার দেখানো' : 'Doctor visit')
            : (bn ? 'পরীক্ষা' : 'Test'),
      });
    }
    return out;
  },

  factKeywords: () => [
    'স্বাস্থ্য', 'ওজন', 'রক্তচাপ', 'চিনি', 'সুগার', 'প্রেসার', 'ঘুম', 'হাঁটা', 'শরীর',
    'health', 'weight', 'blood', 'pressure', 'sugar', 'sleep', 'steps', 'bp',
  ],
};

registerModule(healthModule);
// Restoring a thrown-away medicine puts back its row; its expense is restored from the
// money module's own bin, which is where that row has always lived.
registerTrashTable('health', 'hl_medicines');

// `trash()` above lists three tables (medicines, visits, tests) under one module id, but
// the line above only ever pointed restore/purge at `hl_medicines` — so a trashed visit or
// test looked restorable in the Trash screen and silently did nothing (its id simply isn't
// a row in hl_medicines, so the UPDATE/DELETE affects zero rows). And purging a medicine
// through the generic path would hit hl_doses/hl_medicine_times' hard foreign key on it and
// fail, because nothing ever deleted those child rows first. Custom handlers replace the
// table-only registration above and fix both: find the row's real table before acting on
// it, and clear a medicine's dose/time children before the medicine itself.
const HEALTH_TRASH_TABLES = ['hl_medicines', 'hl_visits', 'hl_tests'] as const;
async function findHealthTrashTable(db: SQLiteDatabase, id: string): Promise<typeof HEALTH_TRASH_TABLES[number] | null> {
  for (const table of HEALTH_TRASH_TABLES) {
    const row = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, id);
    if (row) return table;
  }
  return null;
}
registerTrashHandlers('health', {
  async restore(db, id) {
    const table = await findHealthTrashTable(db, id);
    if (!table) return false;
    const r = await db.runAsync(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, id);
    return r.changes > 0;
  },
  async purge(db, id) {
    const table = await findHealthTrashTable(db, id);
    if (!table) return false;
    let files: { uri: string }[] = [];
    const purged = await atomic(db, async () => {
      if (table === 'hl_medicines') {
        await db.runAsync('DELETE FROM hl_doses WHERE medicine_id = ?', id);
        await db.runAsync('DELETE FROM hl_medicine_times WHERE medicine_id = ?', id);
      }
      // A test ordered at this visit stays; it just stops naming a visit that is gone
      // (the foreign key would otherwise block the delete for ever).
      if (table === 'hl_visits') await db.runAsync('UPDATE hl_tests SET visit_id = NULL WHERE visit_id = ?', id);
      const r = await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, id);
      // A test's report photos go with it: rows now, files once this has committed.
      if (r.changes > 0 && table === 'hl_tests') {
        try {
          files = await db.getAllAsync<{ uri: string }>("SELECT uri FROM attachments WHERE owner_type = 'HL_TEST' AND owner_id = ?", id);
          await db.runAsync("DELETE FROM attachments WHERE owner_type = 'HL_TEST' AND owner_id = ?", id);
        } catch { files = []; /* no attachment store on this schema */ }
      }
      return r.changes > 0;
    });
    if (purged && files.length) await deleteAttachmentFiles(files).catch(() => 0);
    return purged;
  },
});
// Visits and tests expire from Trash on the same 30-day clock as medicines; the handler
// above does the per-table work.
registerTrashExpiryTable('health', 'hl_visits');
registerTrashExpiryTable('health', 'hl_tests');
