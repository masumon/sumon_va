import type { BridgeStatus } from '../../modules/va-bridge';
import type { ChannelsInfo } from './api';
import type { ModuleDef } from './modules';

/**
 * What it takes to connect each platform, and whether each step is done — worked out from what the phone and the server report.
 * The guide on a module screen, the status badges on the module list and the connect test all read this one place.
 */
export type Check = { key: string; ok: boolean; bn: string; en: string; hintBn: string; hintEn: string; fix?: { route?: string; bn: string; en: string } };

export type ConnectInput = { bridge: BridgeStatus; channels: ChannelsInfo | null; received: number; installed: (pkg: string) => boolean };

export type Guide = { stepsBn: string[]; stepsEn: string[] };

const NOTIF_STEPS_BN = [
  'আগে অ্যাপটি এই ফোনে ইনস্টল করে লগইন করে নিন।',
  'নিচের “অনুমতি” অংশে গিয়ে “চ্যাট অ্যাপের বার্তা পড়া” চালু করুন। এটা শুধু একবারই করতে হয়।',
  'নিচের তালিকায় এই অ্যাপের পাশের সুইচটা চালু করুন।',
  'ওই অ্যাপের নিজের সেটিংসে গিয়ে বার্তার নোটিফিকেশন চালু রাখুন। নোটিফিকেশনে বার্তার লেখা দেখানোর অপশনটা বন্ধ করবেন না।',
  '“সংযোগ পরীক্ষা করুন” চাপুন। তারপর অন্য কোনো ফোন থেকে ওই অ্যাপে আপনাকে একটা বার্তা পাঠাতে বলুন। বার্তা এসে গেলে বুঝবেন সংযোগ ঠিক আছে।',
];
const NOTIF_STEPS_EN = [
  'The app must be installed and signed in on this phone.',
  'In “Permissions” below, switch on “Read chat-app messages” (only once).',
  'Switch this app on in the list below.',
  'In that app’s own settings keep message notifications on, and do not hide the message text in notifications.',
  'Press “Test connection”, then ask someone to send you a message in that app from another phone. When it arrives, the connection works.',
];

export function guideFor(m: ModuleDef): Guide {
  if (m.auto === 'telegram') {
    return {
      stepsBn: ['Telegram-এ @BotFather খুলুন। /newbot লিখে বটের নাম ও ইউজারনেম দিন (ইউজারনেমের শেষে bot থাকতে হবে)। এরপর একটা টোকেন পাবেন, সেটা কাউকে দেখাবেন না।', 'BotFather-এ /mybots লিখে আপনার বট বেছে নিন। তারপর Bot Settings খুলে Business Mode চালু করুন।', 'Render-এর Environment অংশে TELEGRAM_BOT_TOKEN ও TELEGRAM_WEBHOOK_SECRET বসান।', 'অ্যাডমিনে গিয়ে “মাধ্যম ও ফোন”, তারপর Telegram খুলে “সংযোগ করুন” চাপুন।', 'বটকে প্রথমে /start, তারপর /id লিখুন। যে সংখ্যাটা পাবেন, সেটা Render-এ TELEGRAM_OWNER_ID হিসেবে বসান।', 'নিচে “Telegram চালু” সুইচটা অন করুন। তারপর “সংযোগ পরীক্ষা করুন” চেপে অন্য অ্যাকাউন্ট থেকে বটকে একটা বার্তা লিখুন।'],
      stepsEn: ['In Telegram open @BotFather → /newbot → name and username (ending in bot) → you get a token (keep it secret).', 'BotFather → /mybots → your bot → Bot Settings → Business Mode on.', 'In Render → Environment add TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET.', 'Admin → Channels & phone → Telegram → press “Connect”.', 'Write /start then /id to the bot and put the number in Render as TELEGRAM_OWNER_ID.', 'Switch “Telegram on” below, then press “Test connection” and write to the bot from another account.'],
    };
  }
  if (m.auto === 'sms') {
    return {
      stepsBn: ['নিচের “অনুমতি” অংশ থেকে SMS পাওয়া, SMS পাঠানো আর মিসড কলের অনুমতি দিন।', 'ফোনে সিম বসানো আছে কিনা আর নেটওয়ার্ক পাচ্ছে কিনা দেখে নিন।', '“সংযোগ পরীক্ষা করুন” চাপুন। তারপর অন্য ফোন থেকে এই নম্বরে একটা SMS পাঠান, অথবা একটা মিসড কল দিন।'],
      stepsEn: ['Allow SMS receive/send and missed-call permissions in “Permissions”.', 'Make sure the SIM and signal are fine.', 'Press “Test connection”, then send an SMS (or give a missed call) to this number from another phone.'],
    };
  }
  return { stepsBn: NOTIF_STEPS_BN, stepsEn: NOTIF_STEPS_EN };
}

export function computeChecks(m: ModuleDef, { bridge, channels, received, installed }: ConnectInput): Check[] {
  const out: Check[] = [];
  const got: Check = { key: 'received', ok: received > 0, bn: 'বার্তা এসেছে', en: 'A message has arrived', hintBn: received > 0 ? `${received} জন এখানে লিখেছেন` : 'এখনও কেউ লেখেননি, সংযোগ পরীক্ষা করুন', hintEn: received > 0 ? `${received} people wrote here` : 'Nobody has written yet — run the test' };

  if (m.auto === 'telegram') {
    const tg = channels?.telegram;
    out.push({ key: 'token', ok: !!tg?.configured, bn: 'বটের গোপন চাবি বসানো', en: 'Bot token set', hintBn: tg?.configured ? `@${tg.bot ?? ''}` : 'বটের গোপন চাবিটা সার্ভারে বসাতে হবে (সেটআপের নির্দেশ ডকে আছে)', hintEn: tg?.configured ? `@${tg.bot ?? ''}` : 'Set TELEGRAM_BOT_TOKEN in Render' });
    out.push({ key: 'webhook', ok: !!tg?.url, bn: 'Telegram থেকে বার্তা আসার পথ চালু', en: 'Webhook connected', hintBn: tg?.url ? 'Telegram আমাদের সার্ভারে বার্তা পাঠাচ্ছে' : 'অ্যাডমিনের “মাধ্যম ও ফোন” অংশে গিয়ে “সংযোগ করুন” চাপুন', hintEn: tg?.url ? 'Telegram sends messages to our server' : 'Admin → Channels & phone → “Connect”' });
    out.push({ key: 'owner', ok: !!tg?.owner_set, bn: 'আপনার Telegram আইডি বসানো', en: 'Your Telegram id set', hintBn: tg?.owner_set ? 'নির্দেশ শুধু আপনার আইডি থেকে মানা হবে' : 'বটকে /id লিখুন; যে সংখ্যাটা আসবে সেটা সার্ভারে বসাতে হবে (সেটআপের নির্দেশ ডকে আছে)', hintEn: tg?.owner_set ? 'Commands work only from your id' : 'Write /id to the bot and set TELEGRAM_OWNER_ID' });
    out.push({ key: 'on', ok: !!channels?.settings.telegram.enabled, bn: 'Telegram চালু (সুইচ)', en: 'Telegram switched on', hintBn: channels?.settings.telegram.enabled ? 'চালু আছে' : 'নিচের সুইচটা অন করুন', hintEn: channels?.settings.telegram.enabled ? 'On' : 'Turn the switch below on' });
    out.push(got);
    return out;
  }
  if (m.auto === 'sms') {
    out.push({ key: 'sms', ok: bridge.smsReceive && bridge.smsSend, bn: 'SMS পাওয়া ও পাঠানোর অনুমতি', en: 'SMS receive/send permission', hintBn: 'অনুমতির পাতা থেকে দিন', hintEn: 'Grant it in Permissions', fix: { route: '/setup', bn: 'অনুমতি দিন', en: 'Grant' } });
    out.push({ key: 'calls', ok: bridge.phoneState && bridge.callLog, bn: 'মিসড কল ধরার অনুমতি', en: 'Missed-call permission', hintBn: 'অনুমতির পাতা থেকে দিন', hintEn: 'Grant it in Permissions', fix: { route: '/setup', bn: 'অনুমতি দিন', en: 'Grant' } });
    out.push({ key: 'service', ok: bridge.serviceAlive, bn: 'ব্যাকগ্রাউন্ড সিঙ্ক চালু', en: 'Background sync running', hintBn: bridge.serviceAlive ? 'চলছে' : 'বন্ধ আছে, অনুমতির পাতায় দেখুন', hintEn: bridge.serviceAlive ? 'Running' : 'Stopped — see Permissions', fix: { route: '/setup', bn: 'ঠিক করুন', en: 'Fix' } });
    out.push(got);
    return out;
  }
  // chat apps read from the phone's notifications
  const apps = m.apps ?? [];
  const here = apps.some((a) => installed(a.pkg));
  const watched = apps.some((a) => bridge.packages.includes(a.pkg));
  out.push({ key: 'installed', ok: here, bn: 'অ্যাপ এই ফোনে আছে', en: 'App is on this phone', hintBn: here ? 'পাওয়া গেছে' : 'ফোনে ইনস্টল করে লগইন করুন', hintEn: here ? 'Found' : 'Install it and sign in' });
  out.push({ key: 'access', ok: bridge.notificationAccess, bn: 'চ্যাট অ্যাপের বার্তা পড়ার অনুমতি', en: 'Permission to read chat-app messages', hintBn: bridge.notificationAccess ? 'দেওয়া আছে' : 'অনুমতির পাতা থেকে চালু করুন', hintEn: bridge.notificationAccess ? 'Granted' : 'Switch it on in Permissions', fix: { route: '/setup', bn: 'চালু করুন', en: 'Switch on' } });
  out.push({ key: 'watched', ok: watched, bn: 'এই অ্যাপের সুইচ চালু', en: 'This app’s switch is on', hintBn: watched ? 'চালু আছে' : 'নিচের তালিকায় অ্যাপের সুইচটা অন করুন', hintEn: watched ? 'On' : 'Turn the app’s switch on below' });
  out.push({ key: 'battery', ok: bridge.batteryExempt && bridge.serviceAlive, bn: 'ব্যাকগ্রাউন্ডে চলতে পারছে', en: 'Can run in the background', hintBn: bridge.batteryExempt && bridge.serviceAlive ? 'চলছে, ব্যাটারি সীমাহীন' : 'ব্যাটারি “সীমাহীন” না করলে ফোন অ্যাপটাকে বন্ধ করে দেয়', hintEn: bridge.batteryExempt && bridge.serviceAlive ? 'Running, battery unrestricted' : 'If battery is not “unrestricted” the phone puts it to sleep', fix: { route: '/setup', bn: 'ঠিক করুন', en: 'Fix' } });
  out.push(got);
  return out;
}

export type Verdict = 'ok' | 'partial' | 'off';

/** Green when messages really arrive, amber when set up but nothing seen yet, red when a required step is missing. */
export function verdict(checks: Check[]): Verdict {
  const must = checks.filter((c) => c.key !== 'received' && c.key !== 'battery');
  if (must.some((c) => !c.ok)) return 'off';
  return checks.find((c) => c.key === 'received')?.ok ? 'ok' : 'partial';
}
