import { withFabRoom } from '../src/ui/FloatingApon';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { useMemo, useState } from 'react';
import { useAppPreferences } from '../src/app/AppPreferences';
import { more } from '../src/i18n/more';
import { AppIcon, type IconName } from '../src/ui/AppIcon';
import {
  border,
  control,
  elevation,
  icon as iconToken,
  layout,
  radius,
  spacing,
  typography,
  type AccentName,
  type ThemeColors,
} from '../src/theme';

// RC.2 redesign, approved by the user: four groups by what a person came to do, one kind
// of row (icon, name, one plain line), and a search box. Nothing was dropped — items that
// were here twice (Finance, Health and the Assistant are in the bottom bar; Debts is on
// Home) are reached from there, "Tags" works by itself in the background, and Trash,
// Permissions and the AI model moved out from inside Settings to where people look.
// app-guide.ts (the Assistant's "how do I…" answers) names these same paths.

type Text2 = { bn: [string, string]; en: [string, string] };
type Item = { href: string; icon: IconName; text: Text2 };
type Group = { key: string; accent: AccentName; title: { bn: string; en: string }; items: Item[] };

const GROUPS: Group[] = [
  {
    key: 'daily', accent: 'orange', title: { bn: 'প্রতিদিনের কাজে', en: 'Every day' },
    items: [
      { href: '/inbox', icon: 'inbox-outline', text: { bn: ['ইনবক্স', 'যা লিখেছেন কিন্তু দিন ঠিক করেননি, সেই কাজগুলো'], en: ['Inbox', 'Tasks you wrote down but have not given a day'] } },
      { href: '/calendar', icon: 'calendar-month-outline', text: { bn: ['ক্যালেন্ডার', 'মাসের কোন দিনে কী আছে, এক নজরে'], en: ['Calendar', 'What is on which day of the month, at a glance'] } },
      { href: '/focus', icon: 'timer-outline', text: { bn: ['ফোকাস', 'টাইমার চালিয়ে একটা কাজে মন দিন'], en: ['Focus', 'Start a timer and give one task your attention'] } },
      { href: '/review', icon: 'chart-box-outline', text: { bn: ['সাপ্তাহিক হিসাব', 'এই সপ্তাহে কী হলো, কী বাকি থাকল'], en: ['Weekly review', 'What happened this week, and what is left'] } },
      { href: '/reminders', icon: 'bell-ring-outline', text: { bn: ['রিমাইন্ডার', 'রিমাইন্ডার ঠিকমতো আসছে কি না — আর আপনার ফোনের জন্য ধাপ'], en: ['Reminders', 'Are reminders arriving — and the steps for your phone'] } },
    ],
  },
  {
    key: 'find', accent: 'blue', title: { bn: 'খোঁজা ও মেমোরি', en: 'Find and remember' },
    items: [
      { href: '/search', icon: 'magnify', text: { bn: ['সব জায়গায় খোঁজা', 'কাজ, মেমোরি, টাকা, মানুষ — যেকোনো কিছু খুঁজুন'], en: ['Search everything', 'Tasks, memories, money, people — find anything'] } },
      { href: '/timeline', icon: 'timeline-text-outline', text: { bn: ['যা যা ঘটেছে', 'টাকা, দেনা, স্বাস্থ্য — কোন দিন কী হলো'], en: ['What happened', 'Money, debts, health — what happened on which day'] } },
      { href: '/on-this-day', icon: 'calendar-heart', text: { bn: ['এই দিনে', 'আগের বছরগুলোতে এই দিনে কী লিখেছিলেন'], en: ['On this day', 'What you wrote on this day in earlier years'] } },
      { href: '/people', icon: 'account-multiple-outline', text: { bn: ['মানুষজন', 'কার সাথে কী হিসাব, কার নম্বর কত'], en: ['People', 'Who you deal with, and their numbers'] } },
    ],
  },
  {
    key: 'safety', accent: 'green', title: { bn: 'আপনার তথ্যের নিরাপত্তা', en: 'Keeping your data safe' },
    items: [
      { href: '/backup', icon: 'database-lock-outline', text: { bn: ['ব্যাকআপ ও ফেরত আনা', 'সব তথ্যের কপি রাখুন, দরকারে ফেরত আনুন'], en: ['Backup and restore', 'Keep a copy of everything; bring it back when needed'] } },
      { href: '/trash', icon: 'delete-restore', text: { bn: ['মুছে ফেলা জিনিস', 'ভুল করে মুছলে ৩০ দিনের মধ্যে ফেরত আনুন'], en: ['Deleted items', 'Deleted by mistake? Bring it back within 30 days'] } },
      { href: '/permissions', icon: 'shield-check-outline', text: { bn: ['অনুমতি', 'অ্যাপ কী কী চায়, কেন চায় — আর কোনটা দিয়েছেন'], en: ['Permissions', 'What the app asks for, why — and what you allowed'] } },
    ],
  },
  {
    key: 'help', accent: 'purple', title: { bn: 'সাহায্য ও অ্যাপ', en: 'Help and the app' },
    items: [
      { href: '/guide', icon: 'lightbulb-on-outline', text: { bn: ['অ্যাপ কী কী পারে', 'সহজ ভাষায় কোন কাজ কোথায় করবেন'], en: ['What this app can do', 'Where to do what, in plain words'] } },
      { href: '/whats-new', icon: 'star-four-points-outline', text: { bn: ['নতুন কী আছে', 'আপন ১.০ — অ্যাপটা কী কী পারে'], en: ['What is new', 'Apon 1.0 — what the app can do'] } },
      { href: '/diagnostics', icon: 'heart-pulse', text: { bn: ['অ্যাপ ঠিক আছে কি না', 'এক চাপে তথ্য, ফাইল আর রিমাইন্ডার পরীক্ষা করুন'], en: ['Is the app all right', 'Check data, files and reminders in one tap'] } },
      { href: '/ai-model', icon: 'chip', text: { bn: ['নিজের AI মডেল', 'চাইলে ফোনে AI যোগ করুন — সব ফোনেই চলে'], en: ['Your own AI model', 'Add an AI to the phone if you like — it runs on the phone'] } },
      { href: '/about', icon: 'information-outline', text: { bn: ['অ্যাপ সম্পর্কে ও গোপনীয়তা', 'আপনার তথ্য শুধু এই ফোনে — নীতি ও যোগাযোগ'], en: ['About and privacy', 'Your data stays on this phone — policy and contact'] } },
      { href: '/settings', icon: 'cog-outline', text: { bn: ['সেটিংস', 'ভাষা, থিম, সময় অঞ্চল, অ্যাপ লক, স্ক্রিনশট'], en: ['Settings', 'Language, theme, time zone, app lock, screenshots'] } },
    ],
  },
];

export default function MoreScreen() {
  const { language, colors, accents } = useAppPreferences();
  const copy = more(language);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bn = language === 'bn';
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => !q || `${it.text.bn.join(' ')} ${it.text.en.join(' ')}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length);

  return (
    <ScrollView keyboardDismissMode="on-drag" style={styles.container} contentContainerStyle={withFabRoom(styles.content)} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{bn ? 'বাকি সব এখানে — কী খুঁজছেন লিখলেই পাবেন।' : 'Everything else is here — type what you are looking for.'}</Text>
      </View>

      <View style={extra(colors).search}>
        <AppIcon name="magnify" size={iconToken.md} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={bn ? 'কী খুঁজছেন?' : 'Looking for…? e.g. backup'}
          placeholderTextColor={colors.textMuted}
          style={extra(colors).searchInput}
          accessibilityLabel={bn ? 'এই তালিকায় খুঁজুন' : 'Search this list'}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Clear'} onPress={() => setQuery('')} hitSlop={12}>
            <AppIcon name="close-circle" size={iconToken.md} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {groups.length === 0 ? (
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: spacing.lg }]}>{bn ? 'এমন কিছু পাওয়া গেল না। অন্য শব্দে লিখে দেখুন।' : 'Nothing like that here. Try another word.'}</Text>
      ) : null}

      {groups.map((group) => {
        const tone = accents[group.accent];
        return (
          <View key={group.key} style={styles.group}>
            <View style={styles.sectionRow}>
              <View style={[styles.sectionDot, { backgroundColor: tone.base }]} />
              <Text style={styles.section}>{group.title[bn ? 'bn' : 'en']}</Text>
            </View>
            <View style={styles.grid}>
              {group.items.map((item) => {
                const [title, description] = item.text[bn ? 'bn' : 'en'];
                return (
                  <Pressable
                    key={item.href}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    accessibilityHint={description}
                    onPress={() => router.push(item.href as never)}
                    style={({ pressed }) => StyleSheet.flatten([styles.tile, pressed && styles.pressed])}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                      <AppIcon name={item.icon} size={iconToken.md} color={tone.on} />
                    </View>
                    <View style={styles.tileCopy}>
                      <Text style={styles.tileTitle}>{title}</Text>
                      <Text style={styles.tileDesc}>{description}</Text>
                    </View>
                    <AppIcon name="chevron-right" size={iconToken.md} color={colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const extra = (colors: ThemeColors) => StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.buttonHeight, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.sm, ...elevation.soft },
  searchInput: { flex: 1, minHeight: layout.minTouchTarget, color: colors.textPrimary, ...typography.body },
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.md, marginBottom: spacing.md },
    eyebrow: { color: colors.primary, ...typography.label, letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, marginTop: spacing.sm },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.sm, lineHeight: 19 },
    brandCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, ...elevation.soft },
    brandBadge: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    brandCopy: { flex: 1, minWidth: 0 },
    brandName: { color: colors.textPrimary, ...typography.body, fontFamily: typography.cardTitle.fontFamily },
    brandMeta: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xxs },
    group: { marginBottom: spacing.lg },
    sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    sectionDot: { width: 7, height: 7, borderRadius: radius.pill },
    sectionAction: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
    sectionActionText: { color: colors.primary, ...typography.caption, fontWeight: '800' },
    section: { flex: 1, color: colors.textMuted, ...typography.section, fontWeight: '700' },
    grid: { gap: spacing.sm },
    gridTwo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tileCompact: { width: '48%', flexGrow: 1, flexDirection: 'column', alignItems: 'flex-start', gap: spacing.sm, minHeight: 0 },
    tileCompactTitle: { color: colors.textPrimary, ...typography.callout, fontWeight: '700' },
    tile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: control.rowMinHeight + spacing.smd, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, ...elevation.soft },
    iconWrap: { width: control.listIconContainer, height: control.listIconContainer, borderRadius: radius.md, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center' },
    tileCopy: { flex: 1, minWidth: 0 },
    tileTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    tileDesc: { color: colors.textSecondary, ...typography.caption, marginTop: spacing.xxs },
    pressed: { opacity: 0.78 },
  });
}
