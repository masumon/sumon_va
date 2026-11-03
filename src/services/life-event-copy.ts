// How an event looks and reads, in one place.
//
// The type on a `life_events` row is machine-readable on purpose — `REPAY`, not `'ঋণ
// পরিশোধ'` — so that renaming a category or switching language cannot change what a sum
// means. That leaves somebody having to turn it back into a word a person recognises, and
// it must be the same word on every screen that ever shows an event.
//
// Kept apart from the service so the service stays free of the interface, and beside the
// vocabulary so a module adding a type has one obvious place to describe it.

import type { AppLanguage } from '../i18n/date-time';
import type { AccentName } from '../theme';
import type { IconName } from '../ui/AppIcon';
import type { LifeEventType } from './life-event-service';

interface Look {
  icon: IconName;
  tone: AccentName;
  /** Which way the money went, for the sign in front of an amount. */
  flow: 'IN' | 'OUT' | 'NONE';
  bn: string;
  en: string;
}

const LOOKS: Record<string, Look> = {
  INCOME: { icon: 'arrow-down-circle-outline', tone: 'green', flow: 'IN', bn: 'আয়', en: 'Income' },
  EXPENSE: { icon: 'arrow-up-circle-outline', tone: 'orange', flow: 'OUT', bn: 'খরচ', en: 'Expense' },
  TRANSFER: { icon: 'swap-horizontal', tone: 'blue', flow: 'NONE', bn: 'স্থানান্তর', en: 'Transfer' },

  // Money that moves without being earned or spent. The whole reason the type exists.
  BORROW: { icon: 'hand-coin-outline', tone: 'purple', flow: 'IN', bn: 'ধার নেওয়া', en: 'Borrowed' },
  LEND: { icon: 'hand-extended-outline', tone: 'purple', flow: 'OUT', bn: 'ধার দেওয়া', en: 'Lent' },
  REPAY: { icon: 'cash-refund', tone: 'blue', flow: 'OUT', bn: 'ঋণ পরিশোধ', en: 'Repaid' },
  COLLECT: { icon: 'cash-plus', tone: 'blue', flow: 'IN', bn: 'পাওনা আদায়', en: 'Collected' },

  GIFT_IN: { icon: 'gift-outline', tone: 'green', flow: 'IN', bn: 'উপহার পাওয়া', en: 'Gift received' },
  GIFT_OUT: { icon: 'gift-outline', tone: 'orange', flow: 'OUT', bn: 'উপহার দেওয়া', en: 'Gift given' },
  GIFT_CONVERSION: { icon: 'hand-heart-outline', tone: 'green', flow: 'NONE', bn: 'ঋণ মাফ', en: 'Debt forgiven' },
  LOSS: { icon: 'alert-circle-outline', tone: 'red', flow: 'OUT', bn: 'হারানো', en: 'Lost' },
  FOUND: { icon: 'magnify-plus-outline', tone: 'green', flow: 'IN', bn: 'কুড়িয়ে পাওয়া', en: 'Found' },

  ASSET_BUY: { icon: 'home-plus-outline', tone: 'purple', flow: 'OUT', bn: 'সম্পদ কেনা', en: 'Asset bought' },
  ASSET_SELL: { icon: 'home-minus-outline', tone: 'purple', flow: 'IN', bn: 'সম্পদ বিক্রি', en: 'Asset sold' },

  MEDICAL: { icon: 'heart-pulse', tone: 'red', flow: 'OUT', bn: 'চিকিৎসা', en: 'Health' },
  OTHER: { icon: 'circle-outline', tone: 'blue', flow: 'NONE', bn: 'অন্যান্য', en: 'Other' },
};

const UNKNOWN: Look = { icon: 'circle-outline', tone: 'blue', flow: 'NONE', bn: 'ঘটনা', en: 'Event' };

/**
 * How to draw an event of this kind.
 *
 * A type nobody has described yet still gets a shape rather than a crash, because the
 * whole point of leaving the column open was that a module could bring its own.
 */
export function eventLook(type: LifeEventType): Look {
  return LOOKS[type] ?? UNKNOWN;
}

export function eventTypeLabel(type: LifeEventType, language: AppLanguage): string {
  const look = eventLook(type);
  return language === 'bn' ? look.bn : look.en;
}

/**
 * Which purposes and sources the app writes, in words.
 *
 * These come from the debt module's vocabulary, which had them first and stores them as
 * keys for the same reason event types are keys.
 */
const WORDS: Record<string, { bn: string; en: string }> = {
  // purposes
  EMERGENCY: { bn: 'জরুরি', en: 'Emergency' },
  FAMILY: { bn: 'পরিবার', en: 'Family' },
  EDUCATION: { bn: 'শিক্ষা', en: 'Education' },
  MEDICAL: { bn: 'চিকিৎসা', en: 'Medical' },
  HOUSE: { bn: 'বাড়ি', en: 'House' },
  VEHICLE: { bn: 'যানবাহন', en: 'Vehicle' },
  PERSONAL: { bn: 'ব্যক্তিগত', en: 'Personal' },
  BUSINESS: { bn: 'ব্যবসা', en: 'Business' },
  OLD_DEBT: { bn: 'পুরোনো ঋণ', en: 'Old debt' },
  DAILY_EXPENSE: { bn: 'দৈনন্দিন খরচ', en: 'Daily expense' },
  // sources and destinations
  SALARY: { bn: 'বেতন', en: 'Salary' },
  FREELANCE: { bn: 'ফ্রিল্যান্স', en: 'Freelance' },
  SAVINGS: { bn: 'সঞ্চয়', en: 'Savings' },
  CASH: { bn: 'নগদ', en: 'Cash' },
  BANK_BALANCE: { bn: 'ব্যাংক', en: 'Bank' },
  FRIEND: { bn: 'বন্ধু', en: 'Friend' },
  BORROWED: { bn: 'ধার করা', en: 'Borrowed' },
  BANK_LOAN: { bn: 'ব্যাংক ঋণ', en: 'Bank loan' },
  CREDIT: { bn: 'বাকি', en: 'Credit' },
  ASSET_SALE: { bn: 'সম্পদ বিক্রি', en: 'Asset sale' },
  RECEIVABLE: { bn: 'পাওনা', en: 'Receivable' },
  CREDITOR: { bn: 'পাওনাদার', en: 'Creditor' },
  BORROWER: { bn: 'দেনাদার', en: 'Borrower' },
  OTHER: { bn: 'অন্যান্য', en: 'Other' },
};

/**
 * A stored key as a word, or the key itself when it is already one.
 *
 * Sources and destinations are half vocabulary and half free text — a lab's name goes in
 * the same column as `SALARY` — so anything unrecognised is shown as typed rather than
 * hidden or mangled.
 */
export function eventWord(key: string | null | undefined, language: AppLanguage): string | null {
  if (!key) return null;
  const known = WORDS[key];
  return known ? (language === 'bn' ? known.bn : known.en) : key;
}
