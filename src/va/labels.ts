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
  4: { bn: 'বারবার', en: 'Repeated', tone: 'warning' },
  5: { bn: 'সাধারণ', en: 'Normal', tone: 'neutral' },
};

export const MODE: Record<Contact['mode'], { bn: string; en: string }> = {
  inherit: { bn: 'সাধারণ নিয়ম', en: 'Default rule' },
  auto: { bn: 'অটো-উত্তর', en: 'Auto-reply' },
  draft: { bn: 'শুধু খসড়া', en: 'Drafts only' },
  notify: { bn: 'শুধু জানাও', en: 'Notify only' },
};

export const MESSAGE_STATUS: Record<Message['status'], { bn: string; en: string }> = {
  received: { bn: 'এসেছে', en: 'Received' },
  draft: { bn: 'খসড়া — আপনার অনুমোদনের অপেক্ষায়', en: 'Draft — waiting for your approval' },
  queued: { bn: 'পাঠানোর অপেক্ষায়', en: 'Queued' },
  sent: { bn: 'পাঠানো হয়েছে', en: 'Sent' },
  failed: { bn: 'পাঠানো যায়নি', en: 'Failed' },
  skipped: { bn: 'বাদ', en: 'Skipped' },
  discarded: { bn: 'বাতিল', en: 'Discarded' },
};

export const displayName = (c: Pick<Contact, 'name' | 'phone'>) => c.name || c.phone.split(':').slice(-1)[0] || '—';
