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
  /** How this platform is connected: read from the phone's notifications, or through its own bot/API. */
  via?: 'notif' | 'telegram' | 'sms';
  /** Phone apps whose notifications this module reads (shown as switches). */
  apps?: { pkg: string; bn: string; en: string }[];
  /** An app the owner added himself (can be removed again). */
  custom?: boolean;
};

/** What the server keeps for an app the owner added with the "add" button. */
export type CustomApp = { key: string; name: string; packages: string[] };

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
  { key: 'linkedin', brand: 'linkedin', icon: 'linkedin', tone: 'blue', bn: 'LinkedIn', en: 'LinkedIn', hintBn: 'LinkedIn-এর বার্তা ও নোটিফিকেশন', hintEn: 'LinkedIn messages and notifications', sources: ['notif:com.linkedin.android'], auto: 'none', apps: [{ pkg: 'com.linkedin.android', bn: 'LinkedIn', en: 'LinkedIn' }] },
  { key: 'tiktok', brand: 'tiktok', icon: 'music-note', tone: 'purple', bn: 'TikTok', en: 'TikTok', hintBn: 'TikTok-এর বার্তা ও নোটিফিকেশন', hintEn: 'TikTok messages and notifications', sources: ['notif:com.zhiliaoapp.musically', 'notif:com.ss.android.ugc.trill'], auto: 'none', apps: [{ pkg: 'com.zhiliaoapp.musically', bn: 'TikTok', en: 'TikTok' }, { pkg: 'com.ss.android.ugc.trill', bn: 'TikTok (এশিয়া)', en: 'TikTok (Asia)' }] },
  { key: 'facebook', brand: 'facebook', icon: 'facebook', tone: 'blue', bn: 'Facebook', en: 'Facebook', hintBn: 'Facebook-এর নোটিফিকেশন', hintEn: 'Facebook notifications', sources: ['notif:com.facebook.katana', 'notif:com.facebook.lite'], auto: 'none', apps: [{ pkg: 'com.facebook.katana', bn: 'Facebook', en: 'Facebook' }, { pkg: 'com.facebook.lite', bn: 'Facebook Lite', en: 'Facebook Lite' }] },
  {
    key: 'telegram', brand: 'telegram', icon: 'send', tone: 'blue', bn: 'Telegram (বট ও ব্যক্তিগত)', en: 'Telegram (bot and personal)', hintBn: 'আপনার বট ও ব্যক্তিগত Telegram', hintEn: 'Your bot and your personal Telegram',
    sources: ['telegram', 'notif:org.telegram.messenger', 'notif:org.thunderdog.challegram'], auto: 'telegram',
    apps: [{ pkg: 'org.telegram.messenger', bn: 'Telegram', en: 'Telegram' }, { pkg: 'org.thunderdog.challegram', bn: 'Telegram X', en: 'Telegram X' }],
  },
  { key: 'sms', brand: 'sms', icon: 'message-text-outline', tone: 'orange', bn: 'SMS ও কল', en: 'SMS and calls', hintBn: 'সাধারণ SMS ও মিসড কল, নম্বরসহ', hintEn: 'Plain SMS and missed calls (which number)', sources: ['sms'], auto: 'sms' },
  { key: 'email', brand: 'email', icon: 'email-outline', tone: 'red', bn: 'ইমেইল', en: 'E-mail', hintBn: 'ইমেইল ও Gmail', hintEn: 'E-mail and Gmail', sources: ['email', 'notif:com.google.android.gm'], auto: 'none', apps: [{ pkg: 'com.google.android.gm', bn: 'Gmail', en: 'Gmail' }] },
  { key: 'imo', brand: 'imo', icon: 'chat-processing-outline', tone: 'blue', bn: 'IMO', en: 'IMO', hintBn: 'IMO-র বার্তা (ফোনের নোটিফিকেশন থেকে পড়া)', hintEn: 'IMO chats (read from phone notifications)', sources: ['notif:com.imo.android.imoim', 'notif:com.imo.android.imous'], auto: 'none', apps: [{ pkg: 'com.imo.android.imoim', bn: 'IMO', en: 'IMO' }, { pkg: 'com.imo.android.imous', bn: 'IMO Lite', en: 'IMO Lite' }] },
  { key: 'viber', brand: 'viber', icon: 'phone-in-talk-outline', tone: 'purple', bn: 'Viber', en: 'Viber', hintBn: 'Viber-এর বার্তা', hintEn: 'Viber chats', sources: ['notif:com.viber.voip'], auto: 'none', apps: [{ pkg: 'com.viber.voip', bn: 'Viber', en: 'Viber' }] },
  { key: 'line', brand: 'line', icon: 'message-processing-outline', tone: 'green', bn: 'LINE', en: 'LINE', hintBn: 'LINE-এর বার্তা', hintEn: 'LINE chats', sources: ['notif:jp.naver.line.android'], auto: 'none', apps: [{ pkg: 'jp.naver.line.android', bn: 'LINE', en: 'LINE' }] },
  { key: 'wechat', brand: 'wechat', icon: 'wechat', tone: 'green', bn: 'WeChat', en: 'WeChat', hintBn: 'WeChat-এর বার্তা', hintEn: 'WeChat chats', sources: ['notif:com.tencent.mm'], auto: 'none', apps: [{ pkg: 'com.tencent.mm', bn: 'WeChat', en: 'WeChat' }] },
  { key: 'signal', brand: 'signal', icon: 'message-lock-outline', tone: 'blue', bn: 'Signal', en: 'Signal', hintBn: 'Signal-এর বার্তা', hintEn: 'Signal chats', sources: ['notif:org.thoughtcrime.securesms'], auto: 'none', apps: [{ pkg: 'org.thoughtcrime.securesms', bn: 'Signal', en: 'Signal' }] },
];

export const moduleByKey = (key: string | undefined) => allModules().find((m) => m.key === key);

/** A readable label for where a conversation came from and under which number/name, e.g. "Messenger · রহিম" or "SMS · 01711…". */
export function sourceLabel(phone: string, channel: string, bn: boolean): string {
  const num = phone.split(':').slice(-1)[0] ?? phone;
  if (channel === 'sms') return `SMS · ${num}`;
  if (channel === 'telegram') return `Telegram · ${num}`;
  if (channel === 'whatsapp') return `Business WhatsApp (API) · +${num}`;
  if (channel === 'notif') {
    const pkg = phone.split(':')[1] ?? '';
    const app = allModules().flatMap((m) => m.apps ?? []).find((a) => a.pkg === pkg || pkg.startsWith(a.pkg.slice(0, 30)));
    const appName = app ? (bn ? app.bn : app.en) : (bn ? 'অ্যাপ' : 'app');
    return bn ? `ফোনের ${appName} · ${num}` : `${appName} on this phone · ${num}`;
  }
  return num;
}

// ── apps the owner adds himself ──────────────────────────────────────────────
// They behave exactly like the built-in modules: same page, same settings card, same reply rules. The list comes from the
// server (assistant settings), so it survives reinstalling the app and is the same on every signed-in phone.
let customModules: ModuleDef[] = [];

export function customToModule(c: CustomApp): ModuleDef {
  return {
    key: c.key, brand: 'phone', icon: 'cellphone-message', tone: 'blue', bn: c.name, en: c.name, custom: true,
    hintBn: 'আপনার যোগ করা অ্যাপ', hintEn: 'An app you added',
    sources: c.packages.map((p) => `notif:${p}`), auto: 'none', via: 'notif',
    apps: c.packages.map((p) => ({ pkg: p, bn: c.name, en: c.name })),
  };
}

export function setCustomModules(list: CustomApp[]): void { customModules = list.map(customToModule); }
/**
 * Keys of chat-app platforms (read only from the phone's notifications) whose app is not installed on this phone.
 * Call it once per list (useMemo), not on every render. Platforms with their own bot/API/e-mail are never listed here.
 */
export function notOnPhone(mods: ModuleDef[], isInstalled: (pkg: string) => boolean): Set<string> {
  const out = new Set<string>();
  for (const m of mods) {
    const pkgs = (m.apps ?? []).map((a) => a.pkg);
    if (!pkgs.length || !m.sources.every((s) => s.startsWith('notif:'))) continue;
    if (!pkgs.some((p) => { try { return isInstalled(p); } catch { return false; } })) out.add(m.key);
  }
  return out;
}
export const allModules = (): ModuleDef[] => [...MODULES, ...customModules];
