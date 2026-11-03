// What this app can actually do.
//
// The app never told anyone what it was for. A first-run tour would have been the obvious
// answer and the wrong one: people skip tours, and the knowledge is needed in month three,
// not minute one.
//
// So this is a page rather than a tour. It is organised by the question a person actually
// arrives with — "where does my money go", "who owes me", "what is happening on the tenth"
// — and every answer is a link straight to the screen that gives it. That makes it a guide
// the first time and a table of contents every time after, which is why it earns a
// permanent place instead of being dismissed once and forgotten.
//
// The cross-module section exists because that part is invisible by design. Nothing on the
// debt screen says it is reading your spending; the only way to know is to be told.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon, type IconName } from '../src/ui/AppIcon';
import { ScreenHeader, useKit } from '../src/ui/AppKit';
import { enabledModules } from '../src/modules';
import { border, icon as iconSize, layout, radius, spacing, typography, type AccentName, type ThemeColors } from '../src/theme';
import { tapLight } from '../src/ui/haptics';

interface Answer {
  /** The question in the user's head, not the feature's name. */
  q: { bn: string; en: string };
  a: { bn: string; en: string };
  icon: IconName;
  tone: AccentName;
  route: string;
  /** Only shown when these modules are on — no point offering a door that is locked. */
  needs?: string[];
}

interface Section {
  title: { bn: string; en: string };
  answers: Answer[];
}

const SECTIONS: Section[] = [
  {
    title: { bn: 'টাকা নিয়ে', en: 'About money' },
    answers: [
      {
        q: { bn: 'এই মাসে আমার টাকা কোথায় গেল?', en: 'Where did my money go this month?' },
        a: { bn: 'খরচ লিখে রাখুন — খাত ধরে ভাগ করে দেখাবে, আর গত মাসের সাথে মিলিয়ে বলবে কোনটা বেড়েছে।', en: 'Write down what you spend; it breaks the month down by category and says what moved against last month.' },
        icon: 'swap-vertical', tone: 'green', route: '/finance', needs: ['finance'],
      },
      {
        q: { bn: 'হাতে আসলে কত আছে?', en: 'How much have I actually got?' },
        a: { bn: 'নগদ, বিকাশ, ব্যাংক আলাদা করে রাখুন। এক পকেট থেকে আরেক পকেটে সরালে সেটা আয়ও নয়, খরচও নয়।', en: 'Keep cash, bKash and the bank apart. Moving money between them counts as neither income nor spending.' },
        icon: 'wallet-outline', tone: 'purple', route: '/finance/wallets', needs: ['finance'],
      },
      {
        q: { bn: 'টাকাটা কোথা থেকে এল, কোথায় গেল?', en: 'Whose money was it, and where did it go?' },
        a: { bn: 'প্রতিটি লেনদেনে মানিব্যাগ বাছুন, আর খরচ, ঋণ শোধ বা ধার দেওয়ায় টাকার উৎস — আয়, ঋণ, উপহার, সঞ্চয় বা অন্যান্য (নিজে লিখুন)। তাহলে দেখা যায় কত খরচ ধারের টাকায় হলো, ঋণ দিয়ে ঋণ শোধ হলো কিনা। পুরোনো অসম্পূর্ণ লেনদেন: আয়-ব্যয় → "হিসাব ঠিক করুন"।', en: 'Pick a wallet for every entry, and for spending, repaying or lending the source — income, loan, gift, savings or other (in your words). Then you see what borrowed money paid for, and loans repaid with loans. Old incomplete entries: Money → "Fix records".' },
        icon: 'source-branch', tone: 'orange', route: '/finance', needs: ['finance'],
      },
      {
        q: { bn: 'কার কাছে কত দেনা, কে কত দেবে?', en: 'Who do I owe, and who owes me?' },
        a: { bn: 'প্রতিটি হিসাব, কিস্তি, সুদ আর তাগাদার রেকর্ড — কেউ অস্বীকার করলে এটাই প্রমাণ।', en: 'Every account, instalment, interest charge and follow-up — the record that settles a dispute.' },
        icon: 'cash-multiple', tone: 'red', route: '/debt', needs: ['debt'],
      },
      {
        q: { bn: 'এ মাসে ঋণ শোধ করা সম্ভব হবে তো?', en: 'Can I afford this month’s repayment?' },
        a: { bn: 'লক্ষ্য ঠিক করে দিন। খরচ বাড়লে অ্যাপ নিজেই বলবে লক্ষ্যটা ঝুঁকিতে পড়ছে কি না।', en: 'Set a target. As spending rises, the app tells you when the target stops being reachable.' },
        icon: 'target', tone: 'blue', route: '/finance/plan', needs: ['finance'],
      },
      {
        q: { bn: 'যাকাত কত আসবে?', en: 'What is my zakat?' },
        a: { bn: 'অ্যাপ যা জানে — জমা টাকা, পাওনা, দেনা — তা দিয়ে হিসাব করে দেয়। স্বর্ণ-জমি নিজে যোগ করে নিতে হবে।', en: 'Works it out from what it knows — savings, dues, debts. Gold and land you add yourself.' },
        icon: 'hand-heart-outline', tone: 'green', route: '/finance/plan', needs: ['finance'],
      },
    ],
  },
  {
    title: { bn: 'মানুষ ও সময় নিয়ে', en: 'People and time' },
    answers: [
      {
        q: { bn: 'রহিমের সাথে আমার হিসাব কেমন?', en: 'Where do I stand with someone?' },
        a: { bn: 'একজন মানুষের সব কিছু এক পাতায় — দেনা, লেনদেন, কবে শেষ তাগাদা দিয়েছেন, আর কল-এসএমএস বোতাম।', en: 'One page per person: debts, transactions, when you last chased them, and the call and message buttons.' },
        icon: 'account-multiple-outline', tone: 'purple', route: '/people',
      },
      {
        q: { bn: '১০ তারিখে কী কী আছে?', en: 'What falls on the tenth?' },
        a: { bn: 'কিস্তি, কাজ আর নিয়মিত খরচ এক ক্যালেন্ডারে। যে দিনে টাকা লাগবে সেই দিন রঙিন।', en: 'Instalments, tasks and regular bills on one calendar. Days that cost money are tinted.' },
        icon: 'calendar-month-outline', tone: 'blue', route: '/calendar',
      },
      {
        q: { bn: 'আজ কী কী করার আছে?', en: 'What do I need to do today?' },
        a: { bn: 'এক লাইনে লিখুন বা বলুন — অ্যাপ নিজেই বোঝে এটা কাজ না মেমোরি, তারিখ কোনটা, কতটা জরুরি।', en: 'Write or say one line; the app works out whether it is a task or a memory, and when it is due.' },
        icon: 'calendar-blank-outline', tone: 'blue', route: '/planning',
      },
      {
        q: { bn: 'ওজন-রক্তচাপ ভালো হচ্ছে না খারাপ?', en: 'Is my health improving or not?' },
        a: { bn: 'মাপ লিখে রাখুন আর লক্ষ্য দিন — কোনটা ভালোর দিকে যাচ্ছে আর কোনটা নয়, অ্যাপ বলে দেবে।', en: 'Record readings and set a target; the app says which way each one is heading.' },
        icon: 'heart-pulse', tone: 'red', route: '/health', needs: ['health'],
      },
    ],
  },
  {
    title: { bn: 'খুঁজে পাওয়া ও মনে রাখা', en: 'Finding and remembering' },
    answers: [
      {
        q: { bn: 'সেই ৫০০০ টাকার হিসাবটা কোথায়?', en: 'Where is that ৳5,000 entry?' },
        a: { bn: 'টাকার অঙ্ক, নাম, বা যেকোনো শব্দ দিয়ে খুঁজুন — কাজ, মেমোরি, দেনা, খরচ সব একসাথে।', en: 'Search by amount, name or any word — tasks, memories, debts and spending together.' },
        icon: 'magnify', tone: 'blue', route: '/search',
      },
      {
        q: { bn: 'অ্যাপকে প্রশ্ন করা যায়?', en: 'Can I just ask it?' },
        a: { bn: 'হ্যাঁ। "এ মাসে কত খরচ হলো" লিখুন বা বলুন — উত্তর এই ফোনেই তৈরি হয়, কোথাও যায় না।', en: 'Yes. Ask "how much did I spend" in words; the answer is worked out on this phone.' },
        icon: 'account-voice', tone: 'purple', route: '/assistant',
      },
      {
        q: { bn: 'ফোন হারালে সব চলে যাবে?', en: 'What if I lose the phone?' },
        a: { bn: 'ব্যাকআপ নিন — একটা ফাইলে সব কিছু, চাইলে পাসওয়ার্ড দিয়ে। নতুন ফোনে ফিরিয়ে আনা যায়।', en: 'Take a backup — everything in one file, optionally password-protected, restorable on a new phone.' },
        icon: 'database-lock-outline', tone: 'green', route: '/backup',
      },
    ],
  },
];

export default function GuideScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [on, setOn] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try { setOn(new Set((await enabledModules(db)).map((m) => m.id))); }
    catch { setOn(new Set()); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title={bn ? 'অ্যাপটা কী কী পারে' : 'What this app can do'}
        subtitle={bn ? 'যে প্রশ্ন নিয়ে আসেন, তার উত্তর কোথায়' : 'The question you arrive with, and where it is answered'}
        backTo="/more"
        backLabel={bn ? 'আরও' : 'More'}
      />

      {/* The part nobody can discover on their own. */}
      <View style={[s.highlight, { backgroundColor: accents.blue.soft, borderColor: accents.blue.border }]}>
        <Text style={[s.highlightTitle, { color: accents.blue.on }]}>
          {bn ? 'অংশগুলো একে অন্যকে চেনে' : 'The parts know about each other'}
        </Text>
        <Text style={s.highlightBody}>
          {bn
            ? 'দেনার পাতা আপনার খরচের হিসাব পড়ে। তাই এক সন্ধ্যার অপ্রয়োজনীয় খরচ এ মাসের ঋণ শোধের হিসাব বদলে দেয় — আর হোমে সেটাই লেখা থাকে। কোনো অংশ আলাদা খাতা নয়।'
            : 'The debt page reads your spending. An evening of unnecessary spending changes what the app says about this month’s repayment, and Home says so. No part is a separate ledger.'}
        </Text>
      </View>

      {SECTIONS.map((section) => {
        const visible = section.answers.filter((answer) => !answer.needs || answer.needs.every((id) => on.has(id)));
        if (!visible.length) return null;
        return (
          <View key={section.title.en}>
            <Text style={s.section}>{bn ? section.title.bn : section.title.en}</Text>
            {visible.map((answer) => {
              const tone = accents[answer.tone];
              return (
                <Pressable
                  key={answer.q.en}
                  accessibilityRole="button"
                  accessibilityLabel={bn ? answer.q.bn : answer.q.en}
                  onPress={() => { tapLight(); router.push(answer.route as never); }}
                  style={({ pressed }) => StyleSheet.flatten([s.card, pressed && s.pressed])}
                >
                  <View style={s.cardTop}>
                    <View style={[s.cardIcon, { backgroundColor: tone.soft }]}>
                      <AppIcon name={answer.icon} size={iconSize.sm} color={tone.on} />
                    </View>
                    <Text style={s.question}>{bn ? answer.q.bn : answer.q.en}</Text>
                    <AppIcon name="chevron-right" size={iconSize.md} color={colors.textMuted} />
                  </View>
                  <Text style={s.answer}>{bn ? answer.a.bn : answer.a.en}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <Pressable
        accessibilityRole="button"
        onPress={() => { tapLight(); router.push('/modules' as never); }}
        style={({ pressed }) => StyleSheet.flatten([s.link, pressed && s.pressed])}
      >
        <AppIcon name="tune-variant" size={iconSize.sm} color={colors.primary} />
        <Text style={s.linkText}>
          {bn ? 'যেগুলো লাগে না সেগুলো বন্ধ করে দিন' : 'Switch off the parts you do not use'}
        </Text>
      </Pressable>

      <Text style={s.footnote}>
        {bn
          ? 'কিছুই ইন্টারনেটে যায় না। সব হিসাব, সব ছবি, সব কথা এই ফোনেই থাকে।'
          : 'Nothing goes to the internet. Every figure, photo and word stays on this phone.'}
      </Text>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    highlight: { borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
    highlightTitle: { ...typography.callout, fontWeight: '800' },
    highlightBody: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs, lineHeight: 20 },
    section: { color: colors.textPrimary, ...typography.section, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    question: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.body, fontWeight: '700' },
    answer: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs, lineHeight: 19 },
    link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.minTouchTarget, marginTop: spacing.md },
    linkText: { color: colors.primary, ...typography.body, fontWeight: '800' },
    footnote: { color: colors.textMuted, ...typography.caption, marginTop: spacing.sm, textAlign: 'center', lineHeight: 17 },
    pressed: { opacity: 0.78 },
  });
}
