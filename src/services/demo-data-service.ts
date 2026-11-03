import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import { bangladeshDateKey, bangladeshMonthKey } from '../i18n/date-time';
import { TRANSFER_CATEGORY } from './finance-service';

// One-tap demo content so a new user can see every screen populated — tasks across all
// priorities and states, memories of every kind, subtasks, a recurrence, and a few
// task↔memory links. Everything is tagged so `clearDemoData` can remove it cleanly
// (every demo row — tasks, memories and the rest — has an id starting "demo-").

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
function at(dayOffset: number, hour: number, min = 0): string {
  const d = now(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, min, 0, 0); return iso(d);
}
function dateKey(dayOffset: number): string {
  const d = now(); d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const rid = () => Math.random().toString(36).slice(2, 9);

/**
 * A day inside the month the user is looking at right now.
 *
 * Demo money used to be dated by "twenty days ago", which on the 6th of a month put the
 * whole salary in the month before — so the demo produced a month summary of zero, which
 * is the one thing it must never do.
 */
function dayThisMonth(day: number): string {
  const month = bangladeshMonthKey();
  const today = Number(bangladeshDateKey(new Date()).slice(8, 10));
  const clamped = Math.max(1, Math.min(day, today));
  return `${month}-${String(clamped).padStart(2, '0')}`;
}

interface DemoTask {
  title: string; notes?: string | null; status: string; priority: string;
  dueOffset?: [number, number, number?]; plannedOffset?: number; recurrence?: string | null;
  completedOffset?: number; subtasks?: string[];
}

// One family's month (1.0 demo, rewritten in plain Bangla): a salaried father, a mother
// with high blood pressure, a son in class five. Every kind of task is here — a daily
// habit, one due today, one tomorrow, one overdue, a weekly and a monthly one, errands
// with steps, the inbox, and a couple already done.
const TASKS: DemoTask[] = [
  { title: 'সকালে ৩০ মিনিট হাঁটা', status: 'PLANNED', priority: 'LOW', dueOffset: [0, 6, 30], recurrence: 'DAILY' },
  { title: 'মায়ের প্রেসারের ওষুধ কেনা', notes: 'অ্যামলোডিপিন ৫ — এক পাতা', status: 'PLANNED', priority: 'HIGH', dueOffset: [0, 18, 0] },
  { title: 'অফিসের মাসিক মিটিং', status: 'IN_PROGRESS', priority: 'MEDIUM', dueOffset: [0, 15, 0] },
  { title: 'ছেলের স্কুলের বেতন দেওয়া', status: 'PLANNED', priority: 'HIGH', dueOffset: [1, 10, 0] },
  { title: 'বিদ্যুৎ বিল দেওয়া', notes: 'শেষ তারিখ পেরিয়ে গেছে — জরিমানা এড়াতে আজই দিন', status: 'PLANNED', priority: 'URGENT', dueOffset: [-1, 12, 0] }, // overdue on purpose
  { title: 'শুক্রবারের বাজার', status: 'PLANNED', priority: 'MEDIUM', dueOffset: [2, 9, 0], recurrence: 'WEEKLY', subtasks: ['চাল-ডাল-তেল', 'মাছ ও সবজি', 'মায়ের জন্য ফল'] },
  { title: 'গ্যাস বিল দেওয়া', status: 'PLANNED', priority: 'MEDIUM', dueOffset: [3, 11, 0], recurrence: 'MONTHLY' },
  { title: 'মাকে ডাক্তারের কাছে নিয়ে যাওয়া', notes: 'প্রেসারের রিপোর্ট সাথে নিতে হবে', status: 'PLANNED', priority: 'HIGH', dueOffset: [5, 17, 0] },
  { title: 'NID কার্ডের ঠিকানা সংশোধন', status: 'PLANNED', priority: 'MEDIUM', plannedOffset: 8, subtasks: ['ফর্ম পূরণ', 'ছবি ও কাগজপত্র', 'অনলাইনে জমা'] },
  { title: 'ইন্টারনেট বিল দেওয়া', status: 'PLANNED', priority: 'MEDIUM', dueOffset: [6, 10, 0], recurrence: 'MONTHLY' },
  { title: 'মায়ের চশমা ঠিক করাতে দেওয়া', status: 'PLANNED', priority: 'LOW', plannedOffset: 4 },
  { title: 'ছাদের পানির ট্যাংক পরিষ্কার করানো', status: 'INBOX', priority: 'LOW' },
  { title: 'পুরোনো কাপড় দান করা', status: 'INBOX', priority: 'LOW' },
  { title: 'মোবাইলের ইন্টারনেট প্যাকেজ কেনা', status: 'COMPLETED', priority: 'MEDIUM', completedOffset: -1, dueOffset: [-1, 20, 0] },
  { title: 'বাড়িওয়ালাকে ভাড়া দেওয়া', status: 'COMPLETED', priority: 'HIGH', completedOffset: -3, dueOffset: [-3, 10, 0] },
];

interface DemoMemory {
  content: string; title?: string | null; kind: string; importance: number; tags: string[];
}

const MEMORIES: DemoMemory[] = [
  { content: 'বাসার ওয়াইফাই পাসওয়ার্ড: Rahman@2026', title: 'ওয়াইফাই', kind: 'FACT', importance: 4, tags: ['পাসওয়ার্ড', 'বাসা', 'demo'] },
  { content: 'বিদ্যুতের প্রিপেইড মিটার নম্বর: ০১২৩ ৪৫৬৭ ৮৯০১', title: 'মিটার নম্বর', kind: 'FACT', importance: 4, tags: ['বিল', 'বাসা', 'demo'] },
  { content: 'মায়ের NID নম্বর: ১৯৬০ ২৬১৯ ৪৫৭ ৮৮২ (ডেমো)', title: 'মায়ের NID', kind: 'FACT', importance: 5, tags: ['কাগজপত্র', 'demo'] },
  { content: 'আমার রক্তের গ্রুপ B+, মায়ের O+', kind: 'FACT', importance: 5, tags: ['স্বাস্থ্য', 'demo'] },
  { content: 'ছেলের স্কুল: উদয়ন বিদ্যালয়, ক্লাস ফাইভ, রোল ১২', kind: 'FACT', importance: 3, tags: ['পরিবার', 'demo'] },
  { content: 'বাড়িওয়ালার ফোন নম্বর: ০১৭০০-০০০০১০ (ডেমো)', kind: 'FACT', importance: 3, tags: ['বাসা', 'demo'] },
  { content: 'মা রাতে হালকা খাবার খান — লবণ কম, ভাত অল্প', kind: 'PREFERENCE', importance: 3, tags: ['পরিবার', 'স্বাস্থ্য', 'demo'] },
  { content: 'বাজার শুক্রবার সকালে করাই ভালো — মাছ তাজা, ভিড় কম', kind: 'PREFERENCE', importance: 2, tags: ['বাজার', 'demo'] },
  { content: 'আমাদের বিবাহবার্ষিকী ১২ ডিসেম্বর', kind: 'EVENT', importance: 4, tags: ['পরিবার', 'demo'] },
  { content: 'ছেলের জন্মদিন ৫ মার্চ', kind: 'EVENT', importance: 4, tags: ['পরিবার', 'demo'] },
  { content: 'গ্যাসের সিলিন্ডার সাধারণত ৪৫ দিন চলে — ৪০ দিনে নতুন অর্ডার দিন', kind: 'NOTE', importance: 3, tags: ['বাসা', 'demo'] },
  { content: 'বাসার বাড়তি চাবি পাশের ফ্ল্যাটে (৪-বি) রাখা আছে', kind: 'NOTE', importance: 3, tags: ['বাসা', 'demo'] },
  { content: 'জরুরি দরকারে (অ্যাম্বুলেন্স, পুলিশ, ফায়ার সার্ভিস) ফোন করুন ৯৯৯ — বিনা খরচে', title: 'জরুরি নম্বর', kind: 'FACT', importance: 5, tags: ['জরুরি', 'demo'] },
  { content: 'মায়ের ডাক্তারের চেম্বার: শনি থেকে বুধ, সন্ধ্যা ৬টা থেকে', kind: 'NOTE', importance: 3, tags: ['স্বাস্থ্য', 'demo'] },
  { content: 'মাসের শুরুতে বাজেট করে নিলে মাসের শেষে টান পড়ে না।', kind: 'REFLECTION', importance: 2, tags: ['ভাবনা', 'demo'] },
];

// ── the other modules ─────────────────────────────────────────────────────────
//
// The same family's money, loans and health, so every page has something real to show
// and every step of the release checklist can be tried on the demo. Every row below
// carries a `demo-` id, so `clearDemoData` lifts all of it out again without touching a
// single thing the user wrote themselves.

const DEMO_PEOPLE: { id: string; name: string; phone: string | null }[] = [
  { id: 'demo-p-karim', name: 'করিম ভাই', phone: '01700000001' },
  { id: 'demo-p-rahima', name: 'রহিমা আপা', phone: '01700000002' },
  { id: 'demo-p-shop', name: 'সালাম স্টোর (মুদি দোকান)', phone: null },
];

/** Two loans and one receivable — one partly repaid, one overdue, one lent out. */
const DEMO_DEBTS: {
  id: string; direction: 'DEBT' | 'RECEIVABLE'; personId: string; title: string;
  principal: number; openedOffset: number; dueOffset: number; paid: number[];
}[] = [
  { id: 'demo-d-1', direction: 'DEBT', personId: 'demo-p-karim', title: 'মায়ের চিকিৎসার জন্য ধার', principal: 5000000, openedOffset: -120, dueOffset: 30, paid: [1000000, 500000] },
  { id: 'demo-d-2', direction: 'DEBT', personId: 'demo-p-shop', title: 'মাসের মুদি বাকি', principal: 350000, openedOffset: -40, dueOffset: -5, paid: [] },
  { id: 'demo-d-3', direction: 'RECEIVABLE', personId: 'demo-p-rahima', title: 'মেয়ের ভর্তির জন্য ধার দেওয়া', principal: 1500000, openedOffset: -60, dueOffset: 15, paid: [500000] },
];

const DEMO_WALLETS: { id: string; name: string; kind: string; opening: number; position: number }[] = [
  { id: 'demo-w-cash', name: 'নগদ টাকা (ডেমো)', kind: 'CASH', opening: 500000, position: 10 },
  { id: 'demo-w-bkash', name: 'বিকাশ (ডেমো)', kind: 'MOBILE', opening: 250000, position: 11 },
  { id: 'demo-w-bank', name: 'ব্যাংক (ডেমো)', kind: 'BANK', opening: 2000000, position: 12 },
];

/**
 * Whose money paid a demo expense: mostly income; the medicine bought with the money
 * borrowed from করিম ভাই (so "spent from a loan" is there to see); a gift from a gift;
 * school fees from savings; a repair from the user's own words under "অন্যান্য".
 */
function demoSource(category: string): { source: string; account: string | null; note?: string } {
  if (category === 'ওষুধ') return { source: 'LOAN', account: 'demo-d-1' };
  if (category === 'উপহার') return { source: 'GIFT', account: null };
  if (category === 'ছেলের পড়াশোনা') return { source: 'SAVINGS', account: null };
  if (category === 'বাসার মেরামত') return { source: 'OTHER', account: null, note: 'সমিতির টাকা থেকে' };
  return { source: 'INCOME', account: null };
}

/** A believable month: salary and tuition in, the usual household costs out. */
const DEMO_ENTRIES: { kind: 'INCOME' | 'EXPENSE'; amount: number; category: string; wallet: string; day: number; method?: string }[] = [
  { kind: 'INCOME', amount: 4500000, category: 'বেতন', wallet: 'demo-w-bank', day: 1, method: 'ব্যাংকে জমা' },
  { kind: 'INCOME', amount: 600000, category: 'টিউশনি', wallet: 'demo-w-cash', day: 3 },
  { kind: 'EXPENSE', amount: 1500000, category: 'বাসা ভাড়া', wallet: 'demo-w-bank', day: 2, method: 'ব্যাংক' },
  { kind: 'EXPENSE', amount: 780000, category: 'বাজার', wallet: 'demo-w-cash', day: 4 },
  { kind: 'EXPENSE', amount: 185000, category: 'বিদ্যুৎ-গ্যাস-পানি', wallet: 'demo-w-bkash', day: 5, method: 'বিকাশ' },
  { kind: 'EXPENSE', amount: 50000, category: 'মোবাইল-ইন্টারনেট', wallet: 'demo-w-bkash', day: 6 },
  { kind: 'EXPENSE', amount: 240000, category: 'যাতায়াত', wallet: 'demo-w-cash', day: 7 },
  { kind: 'EXPENSE', amount: 300000, category: 'ছেলের পড়াশোনা', wallet: 'demo-w-bank', day: 8 },
  { kind: 'EXPENSE', amount: 150000, category: 'উপহার', wallet: 'demo-w-cash', day: 9 },
  { kind: 'EXPENSE', amount: 120000, category: 'বাসার মেরামত', wallet: 'demo-w-cash', day: 10 },
];

/** A budget or two, so the money page shows what "কত খরচ করা যাবে" looks like. */
const DEMO_BUDGETS: { category: string; limit: number }[] = [
  { category: 'বাজার', limit: 1000000 },
  { category: 'যাতায়াত', limit: 300000 },
  { category: 'উপহার', limit: 200000 },
];

/** Where two of the entries happened — names, never map codes. */
const DEMO_PLACES: { entryDay: number; label: string; lat: number; lon: number }[] = [
  { entryDay: 4, label: 'কারওয়ান বাজার', lat: 23.751, lon: 90.393 },
  { entryDay: 6, label: 'মোড়ের রিচার্জের দোকান', lat: 23.751, lon: 90.376 },
];

/** Body readings a family actually keeps: weight, blood pressure, sugar. */
const DEMO_MEASUREMENTS: { metric: string; unit: string; values: [number, number][] }[] = [
  // [days ago, value] — weight in grams, pressure in mmHg, sugar in mmol/L × 10.
  { metric: 'WEIGHT', unit: 'g', values: [[28, 72400], [14, 71800], [3, 71200]] },
  { metric: 'BP_SYSTOLIC', unit: 'mmHg', values: [[20, 150], [6, 142], [1, 134]] },
  { metric: 'BP_DIASTOLIC', unit: 'mmHg', values: [[20, 95], [6, 90], [1, 86]] },
  { metric: 'BLOOD_SUGAR', unit: 'mmol/L', values: [[15, 72], [2, 64]] },
];

/** One target, so "কতটা এগোলেন" has something to measure against. */
const DEMO_TARGET = { metric: 'WEIGHT', target: 68000, direction: 'DOWN', unit: 'g', note: 'ডাক্তার ৬৮ কেজিতে নামাতে বলেছেন' };

/** How each category is judged, so the need-split on Home is not one flat bar. */
const DEMO_NEEDS: [string, string][] = [
  ['বাসা ভাড়া', 'ESSENTIAL'], ['বাজার', 'ESSENTIAL'], ['বিদ্যুৎ-গ্যাস-পানি', 'ESSENTIAL'],
  ['যাতায়াত', 'NEEDED'], ['ছেলের পড়াশোনা', 'NEEDED'], ['মোবাইল-ইন্টারনেট', 'NEEDED'], ['বাসার মেরামত', 'NEEDED'],
  ['উপহার', 'WANT'],
];

const DEMO_MEDICINES: {
  id: string; name: string; reason: string; times: string[];
  perDose: number; total: number; used: number; cost: number; pharmacy: string;
}[] = [
  { id: 'demo-m-1', name: 'প্যারাসিটামল ৫০০', reason: 'জ্বর ও শরীর ব্যথা', times: ['08:00', '14:00', '21:00'], perDose: 1, total: 30, used: 9, cost: 12000, pharmacy: 'পাড়ার ফার্মেসি' },
  { id: 'demo-m-2', name: 'অ্যামলোডিপিন ৫', reason: 'মায়ের উচ্চ রক্তচাপ', times: ['21:00'], perDose: 1, total: 30, used: 12, cost: 15000, pharmacy: 'পাড়ার ফার্মেসি' },
];

const DEMO_VISITS: {
  id: string; doctor: string; specialty: string; day: number;
  reason: string; diagnosis: string; fee: number; extra: number; followUpOffset: number;
}[] = [
  { id: 'demo-v-1', doctor: 'ডা. ফারহানা ইসলাম', specialty: 'মেডিসিন', day: 4, reason: 'মায়ের প্রেসার বেশি, মাথা ঘোরা', diagnosis: 'উচ্চ রক্তচাপ — ওষুধ, লবণ কম, নিয়মিত হাঁটা', fee: 80000, extra: 20000, followUpOffset: 12 },
];

const DEMO_TESTS: {
  id: string; name: string; lab: string; day: number; cost: number; result: string; repeatOffset: number;
}[] = [
  { id: 'demo-t-1', name: 'রক্তের সুগার (খালি পেটে)', lab: 'পাড়ার ডায়াগনস্টিক সেন্টার', day: 4, cost: 40000, result: 'স্বাভাবিক — ৩ মাস পর আবার দেখাবেন', repeatOffset: 80 },
];

export async function clearDemoData(db: SQLiteDatabase): Promise<void> {
  await exclusiveTransaction(db, async () => {
    await db.runAsync("DELETE FROM subtasks WHERE task_id LIKE 'demo-%'");
    await db.runAsync("DELETE FROM notification_deliveries WHERE task_id LIKE 'demo-%'");
    // Only rows the demo itself wrote — every one carries a `demo-` id. Nothing the user
    // wrote is ever matched by a source, a tag or a title.
    await db.runAsync("DELETE FROM relations WHERE id LIKE 'demo-%' OR from_id LIKE 'demo-%' OR to_id LIKE 'demo-%'");
    await db.runAsync("DELETE FROM tasks WHERE id LIKE 'demo-%'");
    await db.runAsync("DELETE FROM memories WHERE id LIKE 'demo-%'");

    // The other modules. Children before parents — an allocation whose transaction has
    // already gone is a row nothing can explain, and the foreign key would refuse it anyway.
    for (const sql of [
      "DELETE FROM hl_doses WHERE medicine_id LIKE 'demo-%'",
      "DELETE FROM hl_medicine_times WHERE medicine_id LIKE 'demo-%'",
      "DELETE FROM hl_medicines WHERE id LIKE 'demo-%'",
      "DELETE FROM hl_tests WHERE id LIKE 'demo-%'",
      "DELETE FROM hl_visits WHERE id LIKE 'demo-%'",
      "DELETE FROM dr_promises WHERE id LIKE 'demo-%' OR account_id LIKE 'demo-%'",
      "DELETE FROM dr_allocations WHERE transaction_id LIKE 'demo-%'",
      "DELETE FROM dr_transaction_sources WHERE transaction_id LIKE 'demo-%'",
      "DELETE FROM dr_installments WHERE account_id LIKE 'demo-%'",
      "DELETE FROM dr_transactions WHERE id LIKE 'demo-%' OR account_id LIKE 'demo-%'",
      "DELETE FROM dr_accounts WHERE id LIKE 'demo-%'",
      "DELETE FROM measurements WHERE id LIKE 'demo-%'",
      "DELETE FROM measurement_targets WHERE note LIKE 'ডাক্তার ৬৮ কেজিতে%'",
      "DELETE FROM hl_prescriptions WHERE id LIKE 'demo-%'",
      "DELETE FROM fin_budgets WHERE id LIKE 'demo-%'",
      "DELETE FROM places WHERE id LIKE 'demo-%'",
      "DELETE FROM fin_entries WHERE id LIKE 'demo-%'",
      "DELETE FROM wallets WHERE id LIKE 'demo-%'",
      "DELETE FROM people WHERE id LIKE 'demo-%'",
    ]) {
      // A table this schema does not have yet simply has nothing to sweep.
      try { await db.runAsync(sql); } catch { /* older schema */ }
    }
  });
}

export interface DemoSeedResult {
  tasks: number; memories: number;
  wallets: number; entries: number; debts: number;
  medicines: number; visits: number; tests: number;
}

export async function seedDemoData(db: SQLiteDatabase): Promise<DemoSeedResult> {
  await clearDemoData(db); // idempotent — reseeding never piles up
  const ts = iso(now());
  let taskCount = 0;
  const memoryIds: string[] = [];

  await exclusiveTransaction(db, async () => {
    for (const t of TASKS) {
      const id = `demo-${rid()}`;
      const dueAt = t.dueOffset ? at(t.dueOffset[0], t.dueOffset[1], t.dueOffset[2] ?? 0) : null;
      const planned = t.plannedOffset !== undefined
        ? dateKey(t.plannedOffset)
        : dueAt
          ? bangladeshDateKey(dueAt)
          : null;
      const completedAt = t.completedOffset !== undefined ? at(t.completedOffset, 12) : null;
      await db.runAsync(
        `INSERT INTO tasks (id,title,notes,status,priority,due_at,completed_at,created_at,updated_at,planned_date,recurrence)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, t.title, t.notes ?? null, t.status, t.priority, dueAt, completedAt, ts, ts, planned, t.recurrence ?? null,
      );
      taskCount += 1;
      if (t.subtasks?.length) {
        for (let i = 0; i < t.subtasks.length; i += 1) {
          await db.runAsync(
            `INSERT INTO subtasks (id,task_id,title,completed,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
            `demo-${rid()}`, id, t.subtasks[i]!, i === 0 && t.status !== 'INBOX' ? 1 : 0, i, ts, ts,
          );
        }
      }
    }
    for (const m of MEMORIES) {
      const id = `demo-${rid()}`;
      memoryIds.push(id);
      await db.runAsync(
        `INSERT INTO memories (id,title,content,kind,source,tags_json,importance,archived,created_at,updated_at,last_accessed_at)
         VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`,
        id, m.title ?? null, m.content, m.kind, 'SYSTEM', JSON.stringify(m.tags), m.importance, ts, ts,
      );
    }
  });

  const money = await seedMoneyDemo(db, ts);
  const debts = await seedDebtDemo(db, ts);
  const health = await seedHealthDemo(db, ts);

  return { tasks: taskCount, memories: memoryIds.length, ...money, ...debts, ...health };
}

/** Wallets, a month of entries, and how each category is judged. */
async function seedMoneyDemo(db: SQLiteDatabase, ts: string): Promise<{ wallets: number; entries: number }> {
  let entries = 0;
  await exclusiveTransaction(db, async () => {
    for (const w of DEMO_WALLETS) {
      await db.runAsync(
        `INSERT OR REPLACE INTO wallets (id,name,kind,opening_paisa,position,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        w.id, w.name, w.kind, w.opening, w.position, ts, ts,
      );
    }
    for (const e of DEMO_ENTRIES) {
      const entryId = `demo-e-${e.day}-${e.category}`;
      // Noon UTC is early evening in Dhaka — unambiguously inside the intended day
      // however a reader slices it, which is what every other screen writes too.
      await db.runAsync(
        `INSERT INTO fin_entries (id,kind,amount_paisa,category,method,person_id,occurred_at,note,recurring,wallet_id,fund_source,fund_account_id,fund_note,created_at,updated_at)
         VALUES (?,?,?,?,?,NULL,?,NULL,NULL,?,?,?,?,?,?)`,
        entryId, e.kind, e.amount, e.category, e.method ?? null,
        `${dayThisMonth(e.day)}T12:00:00.000Z`, e.wallet,
        e.kind === 'EXPENSE' ? demoSource(e.category).source : null,
        e.kind === 'EXPENSE' ? demoSource(e.category).account : null,
        e.kind === 'EXPENSE' ? demoSource(e.category).note ?? null : null,
        ts, ts,
      );
      entries += 1;
    }
    for (const b of DEMO_BUDGETS) {
      await db.runAsync(
        'INSERT OR IGNORE INTO fin_budgets (id,category,month,limit_paisa,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        `demo-b-${b.category}`, b.category, bangladeshMonthKey(new Date()), b.limit, ts, ts,
      );
    }
    // Money moved from cash into bKash: neither income nor spending, and the wallet page
    // shows it on its own line. Two halves sharing one transfer id, as the app writes it.
    const transferId = 'demo-xfer-1';
    for (const leg of [
      { id: 'demo-xfer-1-out', kind: 'EXPENSE', wallet: 'demo-w-cash' },
      { id: 'demo-xfer-1-in', kind: 'INCOME', wallet: 'demo-w-bkash' },
    ]) {
      await db.runAsync(
        `INSERT INTO fin_entries (id,kind,amount_paisa,category,method,person_id,occurred_at,note,recurring,wallet_id,transfer_id,created_at,updated_at)
         VALUES (?,?,?,?,NULL,NULL,?,?,NULL,?,?,?,?)`,
        leg.id, leg.kind, 200000, TRANSFER_CATEGORY,
        `${dayThisMonth(7)}T12:00:00.000Z`, 'নগদ থেকে বিকাশে', leg.wallet, transferId, ts, ts,
      );
      entries += 1;
    }
    for (const [category, need] of DEMO_NEEDS) {
      await db.runAsync(
        `INSERT INTO category_needs (module,category,need,updated_at) VALUES ('finance',?,?,?)
         ON CONFLICT (module,category) DO NOTHING`,
        category, need, ts,
      );
    }
  });
  // A place sits against the entry it belongs to (place-service's own shape).
  for (const p of DEMO_PLACES) {
    const entry = DEMO_ENTRIES.find((e) => e.day === p.entryDay);
    if (!entry) continue;
    try {
      await db.runAsync(
        'INSERT INTO places (id,owner_type,owner_id,latitude,longitude,label,captured_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
        `demo-pl-${p.entryDay}`, 'FINANCE_ENTRY', `demo-e-${entry.day}-${entry.category}`, p.lat, p.lon, p.label, ts, ts,
      );
    } catch { /* older schema */ }
  }
  return { wallets: DEMO_WALLETS.length, entries };
}

/** People, loans, and the repayments already made against them. */
async function seedDebtDemo(db: SQLiteDatabase, ts: string): Promise<{ debts: number }> {
  await exclusiveTransaction(db, async () => {
    for (const p of DEMO_PEOPLE) {
      await db.runAsync(
        'INSERT OR REPLACE INTO people (id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?)',
        p.id, p.name, p.phone, ts, ts,
      );
    }
    for (const d of DEMO_DEBTS) {
      const opened = dateKey(d.openedOffset);
      await db.runAsync(
        `INSERT INTO dr_accounts (id,direction,person_id,title,principal_paisa,opened_date,interest_type,
           interest_basis,first_due_date,final_due_date,priority,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'NONE','ORIGINAL',?,?,'MEDIUM','ACTIVE',?,?)`,
        d.id, d.direction, d.personId, d.title, d.principal, opened,
        dateKey(d.dueOffset), dateKey(d.dueOffset), ts, ts,
      );
      // The opening tranche is a ledger row like any other — the balance is derived from
      // these, never from the column above, so the demo behaves exactly like real data.
      const wallet = DEMO_DEBT_WALLET[d.id] ?? 'demo-w-cash';
      const openingId = `demo-${rid()}`;
      await db.runAsync(
        `INSERT INTO dr_transactions (id,kind,account_id,person_id,amount_paisa,txn_date,reversed,created_at)
         VALUES (?,?,?,?,?,?,0,?)`,
        openingId, d.direction === 'DEBT' ? 'NEW_DEBT' : 'NEW_RECEIVABLE',
        d.id, d.personId, d.principal, opened, ts,
      );
      await demoWalletSide(db, ts, {
        txnId: openingId, incoming: d.direction === 'DEBT', amount: d.principal, date: opened, wallet, personId: d.personId,
        category: d.direction === 'DEBT' ? 'ধার নেওয়া' : 'ধার দেওয়া',
        source: d.direction === 'DEBT' ? 'LOAN' : 'INCOME',
      });
      for (const [i, amount] of d.paid.entries()) {
        const txnId = `demo-${rid()}`;
        const date = dateKey(d.openedOffset + 30 * (i + 1));
        await db.runAsync(
          `INSERT INTO dr_transactions (id,kind,account_id,person_id,amount_paisa,txn_date,reversed,created_at)
           VALUES (?,?,?,?,?,?,0,?)`,
          txnId, d.direction === 'DEBT' ? 'PAYMENT' : 'RECEIPT',
          d.id, d.personId, amount, date, ts,
        );
        if (d.direction === 'DEBT') {
          // First repayment from salary, out of the wallet; the second borrowed for it.
          const borrowed = i > 0;
          await db.runAsync(
            'INSERT INTO dr_transaction_sources (id,transaction_id,source_key,amount_paisa) VALUES (?,?,?,?)',
            `demo-${rid()}`, txnId, borrowed ? 'BORROWED' : 'SALARY', amount,
          );
          if (borrowed) continue;
        }
        await demoWalletSide(db, ts, {
          txnId, incoming: d.direction !== 'DEBT', amount, date, wallet, personId: d.personId,
          category: d.direction === 'DEBT' ? 'ঋণ পরিশোধ' : 'পাওনা আদায়',
          source: d.direction === 'DEBT' ? 'INCOME' : null,
        });
      }
    }
  });
  // "কবে দেবেন বলেছেন" — the promise the debt page tracks and reminds about.
  try {
    await db.runAsync(
      'INSERT INTO dr_promises (id,account_id,amount_paisa,promised_date,follow_up_date,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'demo-pr-1', 'demo-d-3', 500000, dateKey(6), dateKey(8), 'OPEN', 'রহিমা আপা ফোনে বলেছেন এই তারিখে দেবেন', ts, ts,
    );
  } catch { /* older schema */ }
  return { debts: DEMO_DEBTS.length };
}

/** Which pocket each demo loan moved through. */
const DEMO_DEBT_WALLET: Record<string, string> = { 'demo-d-1': 'demo-w-bank', 'demo-d-2': 'demo-w-cash', 'demo-d-3': 'demo-w-bkash' };

/** The wallet side of a demo loan movement, linked to it — all ids `demo-`, cleared as one. */
async function demoWalletSide(
  db: SQLiteDatabase,
  ts: string,
  m: { txnId: string; incoming: boolean; amount: number; date: string; wallet: string; personId: string; category: string; source: string | null },
): Promise<void> {
  const entryId = `demo-dm-${m.txnId}`;
  await db.runAsync(
    `INSERT INTO fin_entries (id,kind,amount_paisa,category,method,person_id,occurred_at,note,recurring,wallet_id,fund_source,fund_account_id,created_at,updated_at)
     VALUES (?,?,?,?,NULL,?,?,NULL,NULL,?,?,NULL,?,?)`,
    entryId, m.incoming ? 'INCOME' : 'EXPENSE', m.amount, m.category, m.personId,
    `${m.date}T12:00:00.000Z`, m.wallet, m.source, ts, ts,
  );
  await db.runAsync(
    'INSERT INTO relations (id,from_type,from_id,to_type,to_id,created_at) VALUES (?,?,?,?,?,?)',
    `demo-rel-${m.txnId}`, 'FINANCE_ENTRY', entryId, 'DEBT_TRANSACTION', m.txnId, ts,
  );
}

/**
 * Medicines with a live schedule, a doctor visit, and a test.
 *
 * The costs are written as ordinary `fin_entries` rows and pointed at, exactly as the
 * health screens do — so the demo also demonstrates the thing that matters most about
 * this module: medical spending shows up in the month once, not twice.
 */
async function seedHealthDemo(db: SQLiteDatabase, ts: string): Promise<{ medicines: number; visits: number; tests: number }> {
  const cost = async (amount: number, category: string, day: number, wallet: string, note: string) => {
    const id = `demo-${rid()}`;
    await db.runAsync(
      `INSERT INTO fin_entries (id,kind,amount_paisa,category,method,person_id,occurred_at,note,recurring,wallet_id,fund_source,fund_account_id,created_at,updated_at)
       VALUES (?,'EXPENSE',?,?,NULL,NULL,?,?,NULL,?,?,?,?,?)`,
      id, amount, category, `${dayThisMonth(day)}T12:00:00.000Z`, note, wallet,
      demoSource(category).source, demoSource(category).account, ts, ts,
    );
    return id;
  };

  await exclusiveTransaction(db, async () => {
    for (const m of DEMO_MEDICINES) {
      const entryId = await cost(m.cost, 'ওষুধ', 2, 'demo-w-cash', `${m.name} · ${m.pharmacy}`);
      await db.runAsync(
        `INSERT INTO hl_medicines (id,name,reason,per_dose,times_per_day,food,start_date,total_units,used_units,
           pharmacy,purchased_on,purchase_entry_id,created_at,updated_at)
         VALUES (?,?,?,?,?,'AFTER',?,?,?,?,?,?,?,?)`,
        m.id, m.name, m.reason, m.perDose, m.times.length, dateKey(-10),
        m.total, m.used, m.pharmacy, dateKey(-10), entryId, ts, ts,
      );
      for (const [seq, at] of m.times.entries()) {
        await db.runAsync(
          'INSERT INTO hl_medicine_times (id,medicine_id,at_time,label,seq) VALUES (?,?,?,NULL,?)',
          `demo-${rid()}`, m.id, at, seq,
        );
      }
    }
    for (const v of DEMO_VISITS) {
      const feeId = await cost(v.fee, 'ডাক্তার', v.day, 'demo-w-cash', `${v.doctor} · ${v.specialty}`);
      const extraId = await cost(v.extra, 'চিকিৎসা', v.day, 'demo-w-cash', `${v.doctor} · ${v.reason}`);
      await db.runAsync(
        `INSERT INTO hl_visits (id,doctor,specialty,visited_on,reason,diagnosis,fee_paisa,extra_paisa,
           follow_up_on,fee_entry_id,extra_entry_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        v.id, v.doctor, v.specialty, dayThisMonth(v.day), v.reason, v.diagnosis,
        v.fee, v.extra, dateKey(v.followUpOffset), feeId, extraId, ts, ts,
      );
    }
    for (const t of DEMO_TESTS) {
      const entryId = await cost(t.cost, 'পরীক্ষা', t.day, 'demo-w-bkash', `${t.name} · ${t.lab}`);
      await db.runAsync(
        `INSERT INTO hl_tests (id,name,tested_on,lab,cost_paisa,result,repeat_on,entry_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        t.id, t.name, dayThisMonth(t.day), t.lab, t.cost, t.result, dateKey(t.repeatOffset), entryId, ts, ts,
      );
    }
  });
  // Body readings and one target, so "শরীরের মাপ" is not an empty card in the demo.
  await exclusiveTransaction(db, async () => {
    for (const m of DEMO_MEASUREMENTS) {
      for (const [daysAgo, value] of m.values) {
        try {
          await db.runAsync(
            'INSERT INTO measurements (id,metric,subject_type,subject_id,value_num,unit,at,note,created_at) VALUES (?,?,?,?,?,?,?,NULL,?)',
            `demo-ms-${m.metric}-${daysAgo}`, m.metric, 'SELF', 'me', value, m.unit, at(-daysAgo, 8), ts,
          );
        } catch { /* older schema */ }
      }
    }
    try {
      await db.runAsync(
        'INSERT OR IGNORE INTO measurement_targets (metric,subject_type,subject_id,target_num,direction,unit,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        DEMO_TARGET.metric, 'SELF', 'me', DEMO_TARGET.target, DEMO_TARGET.direction, DEMO_TARGET.unit, DEMO_TARGET.note, ts, ts,
      );
    } catch { /* older schema */ }
    try {
      await db.runAsync(
        'INSERT INTO hl_prescriptions (id,doctor,issued_on,diagnosis,advice,follow_up_on,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        'demo-rx-1', 'ডা. ফারহানা ইসলাম', dateKey(-20), 'উচ্চ রক্তচাপ',
        'লবণ কম খাবেন, প্রতিদিন ৩০ মিনিট হাঁটবেন, ওষুধ নিয়ম করে খাবেন।', dateKey(10),
        'অ্যামলোডিপিন ৫ — রাতে একটা, প্রতিদিন', ts, ts,
      );
    } catch { /* older schema */ }
  });
  return { medicines: DEMO_MEDICINES.length, visits: DEMO_VISITS.length, tests: DEMO_TESTS.length };
}
