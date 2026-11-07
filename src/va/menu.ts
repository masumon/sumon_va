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
    key: 'assistant', bn: 'প্রতিদিনের', en: 'Every day',
    items: [
      { href: '/', icon: 'view-dashboard-outline', bn: 'হোম', en: 'Home', hintBn: 'আজকের অবস্থা এক নজরে', hintEn: 'Today at a glance' },
      { href: '/inbox', icon: 'inbox-outline', bn: 'ইনবক্স', en: 'Inbox', hintBn: 'সব মাধ্যমের সব বার্তা', hintEn: 'Every message, every channel' },
      { href: '/f0', icon: 'microphone-message', bn: 'সহকারীকে বলুন', en: 'Tell the assistant', hintBn: 'যা জানতে চান বা যাকে যা বলতে চান', hintEn: 'Ask, or have it tell someone' },
      { href: '/tasks', icon: 'checkbox-marked-circle-outline', bn: 'কাজের তালিকা', en: 'Tasks', hintBn: 'কার কাছে কী করতে হবে', hintEn: 'Who needs what from you' },
      { href: '/rules', icon: 'robot-outline', bn: 'আমার অবস্থা ও নিয়ম', en: 'My status and rules', hintBn: 'ঘুমে বা মিটিংয়ে আছি, কখন নিজে উত্তর দেবে', hintEn: 'Away status, when it may answer' },
      { href: '/settings', icon: 'cog-outline', bn: 'সেটিংস', en: 'Settings', hintBn: 'ভাষা, রং, লক, সীমা', hintEn: 'Language, theme, lock, limits' },
    ],
  },
  {
    key: 'modules', bn: 'আমার অ্যাপগুলো', en: 'My apps',
    items: [
      { href: '/channels', icon: 'apps', bn: 'সব অ্যাপ', en: 'All apps', hintBn: 'WhatsApp, SMS, Telegram… কোনটা যুক্ত', hintEn: 'Which apps are connected' },
      ...MODULES.map((m) => ({ href: `/m/${m.key}`, icon: m.icon, bn: m.bn, en: m.en, hintBn: m.hintBn, hintEn: m.hintEn })),
    ],
  },
  {
    key: 'connect', bn: 'আরও সেটিং', en: 'More settings',
    items: [
      { href: '/ai', icon: 'brain', bn: 'AI চাবি', en: 'AI keys', hintBn: 'ফ্রি AI যোগ করুন, কোনটা চলছে দেখুন', hintEn: 'Add free AI, see which work' },
      { href: '/health', icon: 'heart-pulse', bn: 'কিছু ঠিক নেই?', en: 'Something wrong?', hintBn: 'কী ঠিক নেই, কেন, কীভাবে ঠিক করবেন', hintEn: 'What is wrong, why, how to fix' },
      { href: '/setup', icon: 'shield-check-outline', bn: 'অনুমতি', en: 'Permissions', hintBn: 'ফোনের অনুমতিগুলো ঠিক আছে কি না', hintEn: 'Are the phone permissions fine' },
      { href: '/routine', icon: 'calendar-clock', bn: 'সময়সূচি ও জায়গা', en: 'Routine and places', hintBn: 'সহকারী আপনার সম্পর্কে কী বলবে', hintEn: 'What it may say about you' },
      { href: '/scripts', icon: 'text-box-edit-outline', bn: 'সহকারীর বাঁধা উত্তর', en: 'Ready answers', hintBn: 'সহকারী যে কথাগুলো বলে, বদলান', hintEn: 'Edit the sentences it says' },
      { href: '/simulate', icon: 'flask-outline', bn: 'সহকারীকে পরখ করুন', en: 'Try the assistant', hintBn: 'কাউকে কিছু না পাঠিয়ে দেখুন সহকারী কী বলত', hintEn: 'See what it would say, nothing is sent' },
      { href: '/report', icon: 'chart-box-outline', bn: 'হিসাব', en: 'Report', hintBn: 'সহকারী কতটা কাজ করল', hintEn: 'How much it did' },
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
