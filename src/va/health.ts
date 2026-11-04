import type { BridgeStatus } from '../../modules/va-bridge';
import type { ChannelsInfo, HubSummary, Overview } from './api';
import { PERMISSIONS } from './permissions';

/**
 * Everything that can go wrong, worked out from what the app already knows. Each problem says WHAT happened, WHY, and WHAT TO DO,
 * and carries a fix target. The banner, the Health screen and the problem notification all read this one function.
 */
export type Severity = 'critical' | 'warn' | 'info';
export type Fix = { route?: string; action?: 'restart-sync' | 'retry' | 'app-settings'; bn: string; en: string };
export type Issue = { key: string; severity: Severity; bn: string; en: string; whyBn: string; whyEn: string; fix?: Fix };

export type HealthInputs = {
  bridge: BridgeStatus;
  overview: Overview | null;
  overviewError: string | null;
  channels: ChannelsInfo | null;
  hub: HubSummary | null;
  now: number;
};

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

export function computeIssues({ bridge, overview, overviewError, channels, hub, now }: HealthInputs): Issue[] {
  const out: Issue[] = [];
  const revoked = !!bridge.lastError && bridge.lastError.includes('বাতিল');

  if (revoked || (overviewError && overviewError.includes('বাতিল'))) {
    out.push({ key: 'revoked', severity: 'critical', bn: 'এই ফোনের লগইন শেষ হয়ে গেছে', en: 'This phone is signed out', whyBn: 'এই ফোনের অনুমতি বাতিল হয়েছে বা মেয়াদ শেষ। তাই নতুন বার্তা আসছে না। “আবার ঢুকুন” চেপে লগইন করুন।', whyEn: 'The phone’s access was revoked or expired. Messages are not arriving.', fix: { route: '/login', bn: 'আবার ঢুকুন', en: 'Sign in again' } });
  } else if (overviewError && overviewError.includes('সময় লাগছে')) {
    // Only slow, not down: a calm note, never a red alarm.
    out.push({ key: 'slow', severity: 'info', bn: 'সার্ভার একটু ধীরে সাড়া দিচ্ছে', en: 'The server is answering slowly', whyBn: 'ফ্রি সার্ভার মাঝে মাঝে ঘুম থেকে উঠতে সময় নেয়। অপেক্ষা করলেই ঠিক হয়ে যায়।', whyEn: 'The free server sometimes needs a moment to wake. It sorts itself out.', fix: { action: 'retry', bn: 'আবার দেখুন', en: 'Check again' } });
  } else if (overviewError) {
    out.push({ key: 'offline', severity: 'critical', bn: 'সার্ভারের সাথে যোগ হচ্ছে না', en: 'Cannot reach the server', whyBn: `${overviewError}। হয় ইন্টারনেট বন্ধ, নয়তো সার্ভার ঘুমিয়ে আছে (ফ্রি সার্ভার মাঝে মাঝে ঘুমায়, আধ মিনিটের মধ্যে জেগে ওঠে)। ইন্টারনেট দেখে নিন, তারপর “আবার চেষ্টা” চাপুন।`, whyEn: `${overviewError} — the internet is off, or the (free) server is waking up; it takes about half a minute.`, fix: { action: 'retry', bn: 'আবার চেষ্টা', en: 'Try again' } });
  }

  if (!bridge.serviceAlive) {
    out.push({ key: 'sync-stopped', severity: 'critical', bn: 'ব্যাকগ্রাউন্ড সিঙ্ক বন্ধ আছে', en: 'Background sync is stopped', whyBn: 'ফোন অ্যাপটাকে বন্ধ করে দিয়েছে। তাই নতুন বার্তা আসছে না, জরুরি অ্যালার্মও বাজবে না। “সিঙ্ক চালু করুন” চাপুন।', whyEn: 'The phone stopped the app. New messages and urgent alarms will not arrive.', fix: { action: 'restart-sync', bn: 'সিঙ্ক চালু করুন', en: 'Restart sync' } });
  } else if (bridge.lastError && !revoked) {
    out.push({ key: 'sync-error', severity: 'warn', bn: 'সিঙ্কে সমস্যা', en: 'Sync problem', whyBn: bridge.lastError, whyEn: bridge.lastError, fix: { action: 'restart-sync', bn: 'সিঙ্ক আবার চালু', en: 'Restart sync' } });
  } else if (bridge.lastOk && now - bridge.lastOk > 2 * 60_000) {
    const mins = Math.round((now - bridge.lastOk) / 60_000);
    out.push({ key: 'sync-stale', severity: 'warn', bn: 'অনেকক্ষণ ধরে সংযোগ নেই', en: 'No connection for a while', whyBn: `${mins} মিনিট আগে শেষবার সংযোগ হয়েছিল। ইন্টারনেট বন্ধ থাকতে পারে, নয়তো ব্যাটারির সীমার কারণে ফোন অ্যাপ থামিয়ে দিয়েছে। অনুমতির পাতায় ব্যাটারি “সীমাহীন” করুন।`, whyEn: `Last successful sync ${mins} min ago. Battery limits or no internet may be the reason.`, fix: { route: '/setup', bn: 'অনুমতি দেখুন', en: 'Check permissions' } });
  }

  if (bridge.queued > 0) {
    out.push({ key: 'queued', severity: 'warn', bn: `${bridge.queued}টি বার্তা পাঠানো বাকি`, en: `${bridge.queued} messages waiting to upload`, whyBn: 'ইন্টারনেট ছিল না। ইন্টারনেট এলে বার্তাগুলো নিজে থেকেই চলে যাবে, কিছু হারাবে না।', whyEn: 'There was no internet. They go up by themselves when it returns; nothing is lost.', fix: { action: 'retry', bn: 'এখনই চেষ্টা করুন', en: 'Try now' } });
  }

  const missing = PERMISSIONS.filter((p) => p.grade === 'must' && !p.ok(bridge));
  if (missing.length) {
    out.push({ key: 'permissions', severity: 'critical', bn: `${missing.length}টি জরুরি অনুমতি বাকি`, en: `${missing.length} essential permissions missing`, whyBn: 'এগুলো দিন: ' + missing.map((m) => m.bn).join(', '), whyEn: missing.map((m) => m.en).join(', '), fix: { route: '/setup', bn: 'অনুমতি দিন', en: 'Grant permissions' } });
  }

  // When the phone cannot reach the server at all, the AI list is old news; blaming the AI would send the owner to the wrong place.
  if (hub && !overviewError) {
    if (hub.connections.length === 0 || hub.working === 0) {
      out.push({ key: 'ai-down', severity: 'critical', bn: 'কোনো AI চলছে না', en: 'No AI is working', whyBn: `সহকারী বার্তা ভালো করে বুঝতে পারছে না, শুধু সাধারণ নিয়মে চলছে। তাই উত্তরের মান কমে যাবে। “AI ঠিক করুন” চেপে চাবি বা সংযোগ দেখুন।${hub.last_error?.text ? ' শেষ সমস্যা: ' + hub.last_error.text : ''}`, whyEn: `The assistant cannot understand messages and falls back to plain rules.${hub.last_error?.text ? ' Last problem: ' + hub.last_error.text : ''}`, fix: { route: '/ai', bn: 'AI ঠিক করুন', en: 'Fix AI' } });
    } else if (hub.connections.some((c) => c.enabled && (c.status === 'limit' || c.status === 'bad' || c.status === 'error'))) {
      const bad = hub.connections.filter((c) => c.enabled && (c.status === 'limit' || c.status === 'bad' || c.status === 'error')).map((c) => c.label || c.provider).join(', ');
      out.push({ key: 'ai-partial', severity: 'warn', bn: 'কিছু AI সংযোগে সমস্যা আছে', en: 'Some AI connections have problems', whyBn: `${bad}: সীমা শেষ হয়ে গেছে, নয়তো কী (চাবি) কাজ করছে না। বাকিগুলো চলছে।`, whyEn: `${bad} — limit reached or key not working. Others still run.`, fix: { route: '/ai', bn: 'দেখুন', en: 'Review' } });
    }
  }

  if (channels && !overviewError) {
    const tg = channels.telegram;
    if (channels.settings.telegram.enabled && !tg.configured) {
      out.push({ key: 'tg-missing', severity: 'warn', bn: 'Telegram চালু আছে, কিন্তু বট নেই', en: 'Telegram is on but no bot', whyBn: 'Render-এ TELEGRAM_BOT_TOKEN বসানো হয়নি। “দেখুন” চেপে ধাপগুলো অনুসরণ করুন।', whyEn: 'TELEGRAM_BOT_TOKEN is not set.', fix: { route: '/m/telegram', bn: 'দেখুন', en: 'Review' } });
    } else if (tg.configured && (tg.error || tg.last_error)) {
      out.push({ key: 'tg-error', severity: 'warn', bn: 'Telegram সংযোগে সমস্যা আছে', en: 'Telegram problem', whyBn: tg.error || tg.last_error || '', whyEn: tg.error || tg.last_error || '', fix: { route: '/m/telegram', bn: 'দেখুন', en: 'Review' } });
    }
  }

  if (overview) {
    if (overview.failed_24h > 0) out.push({ key: 'send-failed', severity: 'warn', bn: `${overview.failed_24h}টি উত্তর পাঠানো যায়নি`, en: `${overview.failed_24h} replies failed to send`, whyBn: 'গত ২৪ ঘণ্টায় এমন হয়েছে। কারণ প্রতিটি বার্তার নিচে লেখা আছে (যেমন ২৪ ঘণ্টা পার হয়ে গেছে, ফোন অফলাইন ছিল)।', whyEn: 'In the last 24 hours. The reason is written under each message.', fix: { route: '/inbox', bn: 'ইনবক্স দেখুন', en: 'Open inbox' } });
    if (!overview.enabled) out.push({ key: 'assistant-off', severity: 'info', bn: 'সহকারী বন্ধ আছে', en: 'The assistant is switched off', whyBn: 'এখন কোনো বার্তার খসড়া বা উত্তর তৈরি হচ্ছে না। আবার চালাতে “চালু করুন” চাপুন।', whyEn: 'No drafts or replies are being made.', fix: { route: '/rules', bn: 'চালু করুন', en: 'Switch on' } });
    if (overview.tasks_late > 0) out.push({ key: 'tasks-late', severity: 'info', bn: `${overview.tasks_late}টি কাজের সময় পেরিয়ে গেছে`, en: `${overview.tasks_late} tasks overdue`, whyBn: 'কাউকে কথা দিয়েছিলেন, কিন্তু সময় পেরিয়ে গেছে।', whyEn: 'You promised someone and the time has passed.', fix: { route: '/tasks', bn: 'কাজ দেখুন', en: 'Open tasks' } });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
