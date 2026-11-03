import type { IconName } from '../ui/AppKit';
import type { AccentName } from '../theme';
import type { BrandKey } from './BrandLogo';

/**
 * Every way people reach the owner, as separate modules. A module is "which conversations belong to it" (sources) and
 * "can the assistant answer there by itself" (auto). The Modules page, the module screens and the side menu all read this list.
 *
 * A source is a channel ("telegram") or one phone app's chats ("notif:com.whatsapp"), exactly as the server filters them.
 */
export type ModuleDef = {
  key: string;
  brand: BrandKey;
  icon: IconName;
  tone: AccentName;
  bn: string; en: string;
  hintBn: string; hintEn: string;
  sources: string[];
  /** Which switch controls automatic replies here; 'none' = the assistant only drafts, you press send. */
  auto: 'telegram' | 'sms' | 'none';
  /** Phone apps whose notifications this module reads (shown as switches). */
  apps?: { pkg: string; bn: string; en: string }[];
};

export const MODULES: ModuleDef[] = [
  {
    key: 'whatsapp', brand: 'whatsapp', icon: 'whatsapp', tone: 'green', bn: 'WhatsApp', en: 'WhatsApp', hintBn: 'ব্যবসার WhatsApp (API) ও ফোনের WhatsApp', hintEn: 'Business WhatsApp (API) and the phone’s WhatsApp',
    sources: ['whatsapp', 'notif:com.whatsapp', 'notif:com.whatsapp.w4b'], auto: 'none',
    apps: [{ pkg: 'com.whatsapp', bn: 'WhatsApp', en: 'WhatsApp' }, { pkg: 'com.whatsapp.w4b', bn: 'WhatsApp Business', en: 'WhatsApp Business' }],
  },
  {
    key: 'messenger', brand: 'messenger', icon: 'facebook-messenger', tone: 'blue', bn: 'Messenger', en: 'Messenger', hintBn: 'Facebook Messenger-এর বার্তা', hintEn: 'Facebook Messenger chats',
    sources: ['notif:com.facebook.orca', 'notif:com.facebook.mlite'], auto: 'none',
    apps: [{ pkg: 'com.facebook.orca', bn: 'Messenger', en: 'Messenger' }, { pkg: 'com.facebook.mlite', bn: 'Messenger Lite', en: 'Messenger Lite' }],
  },
  { key: 'instagram', brand: 'instagram', icon: 'instagram', tone: 'purple', bn: 'Instagram', en: 'Instagram', hintBn: 'Instagram ডাইরেক্ট বার্তা', hintEn: 'Instagram direct messages', sources: ['notif:com.instagram.android'], auto: 'none', apps: [{ pkg: 'com.instagram.android', bn: 'Instagram', en: 'Instagram' }] },
  {
    key: 'telegram', brand: 'telegram', icon: 'send', tone: 'blue', bn: 'Telegram (বট ও ব্যক্তিগত)', en: 'Telegram (bot and personal)', hintBn: 'আপনার বট ও ব্যক্তিগত Telegram', hintEn: 'Your bot and your personal Telegram',
    sources: ['telegram', 'notif:org.telegram.messenger', 'notif:org.thunderdog.challegram'], auto: 'telegram',
    apps: [{ pkg: 'org.telegram.messenger', bn: 'Telegram', en: 'Telegram' }, { pkg: 'org.thunderdog.challegram', bn: 'Telegram X', en: 'Telegram X' }],
  },
  { key: 'sms', brand: 'sms', icon: 'message-text-outline', tone: 'orange', bn: 'SMS ও কল', en: 'SMS and calls', hintBn: 'সাধারণ SMS ও মিসড কল (কোন নম্বর থেকে এসেছে)', hintEn: 'Plain SMS and missed calls (which number)', sources: ['sms'], auto: 'sms' },
  { key: 'email', brand: 'email', icon: 'email-outline', tone: 'red', bn: 'ইমেইল', en: 'E-mail', hintBn: 'ইমেইল ও Gmail', hintEn: 'E-mail and Gmail', sources: ['email', 'notif:com.google.android.gm'], auto: 'none', apps: [{ pkg: 'com.google.android.gm', bn: 'Gmail', en: 'Gmail' }] },
  {
    key: 'others', brand: 'imo', icon: 'chat-processing-outline', tone: 'yellow', bn: 'অন্যান্য চ্যাট', en: 'Other chats', hintBn: 'IMO, Viber, Signal, LINE', hintEn: 'IMO, Viber, Signal, LINE',
    sources: ['notif:com.imo.android.imoim', 'notif:com.viber.voip', 'notif:org.thoughtcrime.securesms', 'notif:jp.naver.line.android'], auto: 'none',
    apps: [{ pkg: 'com.imo.android.imoim', bn: 'IMO', en: 'IMO' }, { pkg: 'com.viber.voip', bn: 'Viber', en: 'Viber' }, { pkg: 'org.thoughtcrime.securesms', bn: 'Signal', en: 'Signal' }, { pkg: 'jp.naver.line.android', bn: 'LINE', en: 'LINE' }],
  },
];

export const moduleByKey = (key: string | undefined) => MODULES.find((m) => m.key === key);

/** A readable label for where a conversation came from and under which number/name, e.g. "Messenger · রহিম" or "SMS · 01711…". */
export function sourceLabel(phone: string, channel: string, bn: boolean): string {
  const num = phone.split(':').slice(-1)[0] ?? phone;
  if (channel === 'sms') return `SMS · ${num}`;
  if (channel === 'telegram') return `Telegram · ${num}`;
  if (channel === 'whatsapp') return `WhatsApp · +${num}`;
  if (channel === 'notif') {
    const pkg = phone.split(':')[1] ?? '';
    const app = MODULES.flatMap((m) => m.apps ?? []).find((a) => a.pkg === pkg || pkg.startsWith(a.pkg.slice(0, 30)));
    return `${app ? (bn ? app.bn : app.en) : (bn ? 'ফোনের অ্যাপ' : 'Phone app')} · ${num}`;
  }
  return num;
}
