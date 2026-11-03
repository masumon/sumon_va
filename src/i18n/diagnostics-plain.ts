// The Diagnostics checks in words anyone understands (RC.2). diagnostics-service.ts keeps
// its English (tests and logs read it); this turns each check into a plain sentence for the
// screen — "Schema v24; expected v24" means nothing to the person holding the phone.

import { asciiDigitsToBengali } from '../services/debt/money';

type Check = { id: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; label: string; detail: string };

const NAME_BN: Record<string, string> = {
  database: 'তথ্যের খাতা',
  notifications: 'নোটিফিকেশনের অনুমতি',
  scheduled: 'সেট করা রিমাইন্ডার',
  integrity: 'তথ্য অক্ষত আছে কি না',
  'backup-coverage': 'ব্যাকআপে সব আছে কি না',
  records: 'আপনার তথ্য',
  'voice-offline': 'ইন্টারনেট ছাড়া কথা বলে লেখা',
};

const NAME_EN: Record<string, string> = {
  database: 'Your data',
  notifications: 'Notification permission',
  scheduled: 'Reminders set',
  integrity: 'Is your data intact',
  'backup-coverage': 'Does a backup carry everything',
  records: 'What you have saved',
  'voice-offline': 'Speaking to write without internet',
};

const RECORD_BN: Record<string, string> = { tasks: 'কাজ', memories: 'মেমোরি', people: 'মানুষ', debts: 'দেনা-পাওনা', entries: 'আয়-ব্যয়', files: 'ফাইল' };

export function plainCheckLabel(check: Check, bn: boolean): string {
  return (bn ? NAME_BN : NAME_EN)[check.id] ?? check.label;
}

export function plainCheckDetail(check: Check, bn: boolean): string {
  if (!bn) return plainDetailEn(check);
  const n = (s: string) => asciiDigitsToBengali(s);
  const unknown = 'এই মুহূর্তে যাচাই করা গেল না — পরে আবার চালিয়ে দেখুন।';
  switch (check.id) {
    case 'database':
      return check.status === 'PASS' ? 'ঠিক আছে — সব তথ্য পড়া যাচ্ছে।' : 'খাতায় সমস্যা দেখা যাচ্ছে। এখনই একটি ব্যাকআপ নিন এবং আমাদের জানান।';
    case 'notifications':
      if (check.status === 'PASS') return 'দেওয়া আছে — রিমাইন্ডার দেখাতে পারবে।';
      if (check.status === 'FAIL') return 'দেওয়া নেই — রিমাইন্ডার দেখাবে না। আরও › অনুমতি থেকে দিন।';
      return unknown;
    case 'scheduled': {
      const count = check.detail.match(/^(\d+)/u)?.[1];
      return count !== undefined ? `এখন ${n(count)}টি রিমাইন্ডার ফোনে সেট করা আছে।` : unknown;
    }
    case 'integrity':
      if (check.status === 'PASS') return 'সব তথ্য অক্ষত আছে।';
      if (check.status === 'FAIL') return 'কিছু তথ্যে গরমিল পাওয়া গেছে। একটি ব্যাকআপ নিয়ে আমাদের জানান।';
      return unknown;
    case 'backup-coverage':
      return check.status === 'PASS' ? 'হ্যাঁ — ব্যাকআপে আপনার সব তথ্য যায়।' : check.status === 'FAIL' ? 'কিছু তথ্য ব্যাকআপে যাচ্ছে না। আমাদের জানান।' : unknown;
    case 'records': {
      if (check.status !== 'PASS') return unknown;
      const parts = [...check.detail.matchAll(/(\d+)\s+([a-z]+)/gu)].map(([, count, what]) => `${RECORD_BN[what!] ?? what} ${n(count!)}টি`);
      return parts.length ? parts.join(' · ') : 'এখনো কিছু রাখা হয়নি।';
    }
    case 'voice-offline':
      if (/no offline recogni/iu.test(check.detail)) return 'এই ফোনে ইন্টারনেট ছাড়া কথা বোঝার ব্যবস্থা নেই — লিখে দিলে সব কাজই হয়।';
      if (check.status === 'PASS') return 'চালু আছে — ইন্টারনেট ছাড়াই কথা বলে লেখা যাবে।';
      if (check.status === 'FAIL') return 'বাংলার ভাষা-প্যাকেট নামানো নেই। নিচের বোতাম চেপে একবার নামিয়ে নিন।';
      return unknown;
    default:
      return check.detail;
  }
}

/** The same sentences in plain English — no schema versions, no table names. */
function plainDetailEn(check: Check): string {
  const unknown = 'Could not be checked just now — try again later.';
  switch (check.id) {
    case 'database':
      return check.status === 'PASS' ? 'Fine — all your data can be read.' : 'Something is wrong with your data. Take a backup now and let us know.';
    case 'notifications':
      if (check.status === 'PASS') return 'Allowed — reminders can show.';
      if (check.status === 'FAIL') return 'Not allowed — reminders will not show. Allow it from More › Permissions.';
      return unknown;
    case 'scheduled': {
      const count = check.detail.match(/^(d+)/u)?.[1];
      return count !== undefined ? `${count} reminder(s) are set on the phone right now.` : unknown;
    }
    case 'integrity':
      if (check.status === 'PASS') return 'All your data is intact.';
      if (check.status === 'FAIL') return 'Some of your data does not add up. Take a backup and let us know.';
      return unknown;
    case 'backup-coverage':
      return check.status === 'PASS' ? 'Yes — a backup carries all your data.' : check.status === 'FAIL' ? 'Some data is not going into the backup. Let us know.' : unknown;
    case 'records':
      return check.status === 'PASS' ? check.detail : unknown;
    case 'voice-offline':
      if (/no offline recogni/iu.test(check.detail)) return 'This phone cannot understand speech without internet — typing does everything.';
      if (check.status === 'PASS') return 'On — you can speak to write without internet.';
      if (check.status === 'FAIL') return 'The language pack is not downloaded. Tap the button below to get it once.';
      return unknown;
    default:
      return check.detail;
  }
}
