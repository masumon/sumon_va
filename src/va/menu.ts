import type { IconName } from '../ui/AppKit';
import { MODULES } from './modules';

/**
 * The ONE list of everything in the app. The bottom bar, the side drawer and the "More" page all read it,
 * so a feature added here appears everywhere and can never exist in one place and be missing in another.
 */
export type MenuItem = { href: string; icon: IconName; bn: string; en: string; hintBn: string; hintEn: string };
export type MenuSection = { key: string; bn: string; en: string; items: MenuItem[] };

export const MENU: MenuSection[] = [
  {
    key: 'assistant', bn: 'সহকারী', en: 'Assistant',
    items: [
      { href: '/', icon: 'view-dashboard-outline', bn: 'ড্যাশবোর্ড', en: 'Dashboard', hintBn: 'আজকের অবস্থা এক নজরে', hintEn: 'Today at a glance' },
      { href: '/inbox', icon: 'inbox-outline', bn: 'ইনবক্স', en: 'Inbox', hintBn: 'সব মাধ্যমের সব বার্তা', hintEn: 'Every message, every channel' },
      { href: '/tasks', icon: 'checkbox-marked-circle-outline', bn: 'কাজের তালিকা', en: 'Tasks', hintBn: 'কার কাছে কী করতে হবে', hintEn: 'Who needs what from you' },
      { href: '/rules', icon: 'robot-outline', bn: 'সহকারীর অবস্থা ও নিয়ম', en: 'Assistant status & rules', hintBn: 'ঘুমে বা মিটিংয়ে আছি, উত্তরের নিয়ম', hintEn: 'Away status and reply rules' },
      { href: '/routine', icon: 'calendar-clock', bn: 'সময়সূচি, অবস্থা ও জায়গা', en: 'Routine, status and places', hintBn: 'সহকারী আপনার সম্পর্কে কী বলবে', hintEn: 'What it may say about you' },
      { href: '/scripts', icon: 'text-box-edit-outline', bn: 'উত্তরের লেখা', en: 'Reply wording', hintBn: 'সহকারী যা লেখে তা বদলান', hintEn: 'Edit the sentences it says' },
      { href: '/simulate', icon: 'flask-outline', bn: 'পরীক্ষা', en: 'Test', hintBn: 'আসল বার্তা না পাঠিয়ে দেখুন সহকারী কী করত', hintEn: 'See what it would do, safely' },
      { href: '/report', icon: 'chart-box-outline', bn: 'রিপোর্ট', en: 'Report', hintBn: 'সহকারী কতটা কাজ করল, কত অনুমোদন হলো', hintEn: 'How much it did, approvals' },
    ],
  },
  {
    key: 'modules', bn: 'মডিউল', en: 'Modules',
    items: [
      { href: '/channels', icon: 'apps', bn: 'সব মডিউল', en: 'All modules', hintBn: 'প্রতিটি মাধ্যম আলাদা করে', hintEn: 'Each channel apart' },
      ...MODULES.map((m) => ({ href: `/m/${m.key}`, icon: m.icon, bn: m.bn, en: m.en, hintBn: m.hintBn, hintEn: m.hintEn })),
    ],
  },
  {
    key: 'connect', bn: 'সংযোগ', en: 'Connections',
    items: [
      { href: '/wa-health', icon: 'whatsapp', bn: 'WhatsApp সংযোগ', en: 'WhatsApp connection', hintBn: 'ব্যবসার WhatsApp ঠিক চলছে কিনা', hintEn: 'Is business WhatsApp healthy' },
      { href: '/ai', icon: 'brain', bn: 'AI সংযোগ', en: 'AI connections', hintBn: 'কী, মডেল, আগে ফ্রি তারপর পেইড', hintEn: 'Keys, models, free before paid' },
      { href: '/health', icon: 'heart-pulse', bn: 'সমস্যা ও স্বাস্থ্য', en: 'Problems & health', hintBn: 'কী ঠিক নেই, কেন, কীভাবে ঠিক করবেন', hintEn: 'What is wrong, why, how to fix' },
      { href: '/setup', icon: 'shield-check-outline', bn: 'অনুমতি', en: 'Permissions', hintBn: 'সব অনুমতি ও তার অবস্থা', hintEn: 'Every permission and its state' },
    ],
  },
  {
    key: 'app', bn: 'অ্যাপ', en: 'App',
    items: [
      { href: '/settings', icon: 'cog-outline', bn: 'সেটিংস', en: 'Settings', hintBn: 'ভাষা, রং, লক, সীমা', hintEn: 'Language, theme, lock, limits' },
      { href: '/about', icon: 'information-outline', bn: 'অ্যাপ সম্পর্কে', en: 'About', hintBn: 'ক্রেডিট ও সংস্করণ', hintEn: 'Credits and version' },
    ],
  },
];

export const ALL_ITEMS: MenuItem[] = MENU.flatMap((s) => s.items);

/** Title for the header bar from the current path. */
export function titleFor(pathname: string, bn: boolean): string {
  const mod = pathname.startsWith('/m/') ? MODULES.find((m) => pathname === `/m/${m.key}`) : undefined;
  if (mod) return bn ? mod.bn : mod.en;
  const hit = ALL_ITEMS.find((i) => (i.href === '/' ? pathname === '/' : pathname === i.href || pathname.startsWith(`${i.href}/`)));
  if (hit) return bn ? hit.bn : hit.en;
  if (pathname.startsWith('/contact')) return bn ? 'ব্যক্তি' : 'Contact';
  if (pathname.startsWith('/more')) return bn ? 'আরও' : 'More';
  return bn ? 'সুমনের ভার্চুয়াল সহকারী' : "Sumon's Virtual Assistant";
}
