import type { Channel, Contact, Message } from './api';

/** Plain names and icons for every code the server sends, in one place — so no screen ever shows "notif" or "proposal_sent". */
export const CHANNEL: Record<Channel, { bn: string; en: string; icon: 'whatsapp' | 'send' | 'message-text-outline' | 'cellphone-message' | 'email-outline' | 'webhook' }> = {
  whatsapp: { bn: 'WhatsApp', en: 'WhatsApp', icon: 'whatsapp' },
  telegram: { bn: 'Telegram', en: 'Telegram', icon: 'send' },
  sms: { bn: 'SMS ও কল', en: 'SMS & calls', icon: 'message-text-outline' },
  notif: { bn: 'ফোনের অ্যাপ', en: 'Phone apps', icon: 'cellphone-message' },
  email: { bn: 'ইমেইল', en: 'Email', icon: 'email-outline' },
  webhook: { bn: 'ওয়েবহুক', en: 'Webhook', icon: 'webhook' },
};

export const PRIORITY: Record<number, { bn: string; en: string; tone: 'danger' | 'warning' | 'primary' | 'neutral' }> = {
  1: { bn: 'জরুরি', en: 'Urgent', tone: 'danger' },
  2: { bn: 'গুরুত্বপূর্ণ', en: 'Important', tone: 'warning' },
  3: { bn: 'নতুন কাজ', en: 'New work', tone: 'primary' },
  4: { bn: 'বারবার আসা', en: 'Repeated', tone: 'warning' },
  5: { bn: 'সাধারণ', en: 'Normal', tone: 'neutral' },
};

export const MODE: Record<Contact['mode'], { bn: string; en: string }> = {
  inherit: { bn: 'সাধারণ নিয়ম', en: 'Default rule' },
  auto: { bn: 'নিজে উত্তর', en: 'Auto-reply' },
  draft: { bn: 'শুধু খসড়া', en: 'Drafts only' },
  notify: { bn: 'শুধু জানাবে', en: 'Notify only' },
};

export const MESSAGE_STATUS: Record<Message['status'], { bn: string; en: string }> = {
  received: { bn: 'এসেছে', en: 'Received' },
  draft: { bn: 'খসড়া, আপনার অনুমোদনের অপেক্ষায়', en: 'Draft — waiting for your approval' },
  queued: { bn: 'পাঠানোর অপেক্ষায়', en: 'Queued' },
  sent: { bn: 'পাঠানো হয়েছে', en: 'Sent' },
  failed: { bn: 'পাঠানো যায়নি', en: 'Failed' },
  skipped: { bn: 'বাদ দেওয়া হয়েছে', en: 'Skipped' },
  discarded: { bn: 'বাতিল', en: 'Discarded' },
};

export const displayName = (c: Pick<Contact, 'name' | 'phone'>) => c.name || c.phone.split(':').slice(-1)[0] || '—';

/** The four looks of the app. Settings and the side menu both read this one list. */
export const THEME_OPTIONS = [
  { value: 'system', bn: 'ফোনের মতো', en: 'Auto' },
  { value: 'light', bn: 'দিন', en: 'Day' },
  { value: 'dark', bn: 'রাত', en: 'Night' },
  { value: 'dim', bn: 'কম আলো', en: 'Low light' },
] as const;
export type ThemeChoice = (typeof THEME_OPTIONS)[number]['value'];
export const LANGUAGE_OPTIONS = [{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'English' }] as const;

/** The four kinds of message: what it is, a one-line meaning for a non-technical owner, and what the assistant does with it. */
export const CATEGORY = {
  business: { bn: 'ব্যবসায়িক', en: 'Business', icon: 'briefcase-outline', tone: 'primary', hintBn: 'কাজ, দাম, অর্ডার, বুকিং। সহকারী উত্তর দিতে পারে', hintEn: 'Work, prices, orders — the assistant may reply' },
  personal: { bn: 'ব্যক্তিগত', en: 'Personal', icon: 'account-heart-outline', tone: 'success', hintBn: 'পরিবার ও কাছের মানুষ। আপনি নিজে উত্তর দেন', hintEn: 'Family and close people — you answer yourself' },
  social: { bn: 'সামাজিক', en: 'Social', icon: 'party-popper', tone: 'warning', hintBn: 'দাওয়াত, শুভেচ্ছা, দোয়া। আপনি যা ভালো মনে করেন', hintEn: 'Invitations, greetings — your call' },
  spam: { bn: 'প্রচার/স্প্যাম', en: 'Spam', icon: 'delete-empty-outline', tone: 'neutral', hintBn: 'বিজ্ঞাপন। চুপচাপ সরিয়ে রাখা হয়', hintEn: 'Ads — quietly set aside' },
} as const;
export const CATEGORY_KEYS = ['business', 'personal', 'social', 'spam'] as const;

/** What the phone's screen, touch and motion say about you right now (used for the automatic status). */
export const PRESENCE = {
  active: { bn: 'আপনি এখন ফোন ব্যবহার করছেন', en: 'You are using the phone' },
  idle: { bn: 'ফোন কিছুক্ষণ ধরা হয়নি', en: 'The phone has not been touched for a while' },
  still: { bn: 'ফোন অনেকক্ষণ স্থির, তাই ধরে নিচ্ছি আপনি বিশ্রামে আছেন', en: 'The phone has been still for long, so we assume you are resting' },
  moving: { bn: 'আপনি পথে আছেন (লোকেশন বদলাচ্ছে)', en: 'You are on the move (location is changing)' },
  unknown: { bn: '', en: '' },
} as const;
