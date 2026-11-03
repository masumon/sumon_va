// The two sentences every money form uses — why it cannot save yet, and what a back-dated
// entry does to today's balance. Plain functions (no UI), so they can be tested alone and
// used by any form; the pickers re-export them.

import type { FundSource } from './finance-service';

/**
 * What a back-dated entry does to a wallet: its balance is today's, so money that arrived
 * (or left) long ago moves today's figure too. Said plainly, so a past loan entered now is
 * followed by whatever was done with that money since — otherwise the balance runs high.
 */
export function backDatedNote(dayKey: string | null | undefined, today: string, incoming: boolean, bn: boolean): string | null {
  if (!dayKey || dayKey >= today) return null;
  return incoming
    ? (bn ? 'পুরোনো তারিখ: এই টাকা মানিব্যাগের আজকের ব্যালান্সেও যোগ হবে। সেই টাকা পরে খরচ হয়ে থাকলে সেই খরচও লিখে রাখুন।' : 'An old date: this money is added to the wallet\'s balance today too. If it was spent since, record that spending as well.')
    : (bn ? 'পুরোনো তারিখ: এই টাকা মানিব্যাগের আজকের ব্যালান্স থেকেও কমবে।' : 'An old date: this money comes off the wallet\'s balance today too.');
}

/**
 * Why a money form cannot save yet, in the words the snackbar shows — or null when it can.
 * One wording for every form.
 */
export function moneyDetailsProblem(input: { walletId: string | null; needsSource: boolean; fundSource: FundSource | null }, bn: boolean): string | null {
  if (!input.walletId) return bn ? 'মানিব্যাগ বাছুন — না থাকলে সেখানেই একটা তৈরি করুন।' : 'Choose a wallet — or make one right there.';
  if (input.needsSource && !input.fundSource) return bn ? 'টাকার উৎস বাছুন — আয়, ঋণ, উপহার, সঞ্চয় বা অন্যান্য।' : 'Choose the source — income, loan, gift, savings or other.';
  return null;
}

/**
 * "অন্যান্য" with the user's own words. A chosen OTHER plus typed text is stored as that
 * text (the label helpers show unknown keys as written); OTHER with nothing typed stays OTHER.
 */
export function withOwnWords(key: string | null, text: string): string | null {
  return key === 'OTHER' && text.trim() ? text.trim() : key;
}

/** The reverse, for a form reopening a saved value: a value outside the list is the user's own words. */
export function splitOwnWords(value: string | null | undefined, known: readonly string[]): { key: string | null; text: string } {
  if (!value) return { key: null, text: '' };
  return known.includes(value) ? { key: value, text: '' } : { key: 'OTHER', text: value };
}
