import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { AponMark } from '../src/ui/AponMark';
import { ActivityIndicator, Animated, AppState, BackHandler, Easing, Linking, Pressable, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from '../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../src/app/AppPreferences';
import { initializeNotifications } from '../src/services/notification.service';
import { getPermission, requestNotificationPermissionWithConsent } from '../src/services/permission-service';
import { isAggressiveOem, oemFamily } from '../src/services/oem-background';
import { seedDemoData } from '../src/services/demo-data-service';
import { AppIcon, type IconName } from '../src/ui/AppIcon';
import { border, control, icon, layout, opacity, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../src/theme';

// UX-02: phones known to stop background apps. The same test the Home reminder card and
// the permissions page use — one list of makers, so the three can never disagree.
const OEM_BRAND = String(Device.manufacturer || Device.brand || '');
const AGGRESSIVE_OEM = isAggressiveOem(oemFamily(Device.manufacturer, Device.brand));

// Ordered by what a new person most needs to understand first (see the audit in the
// release tracker): what Apon is and that it stays on the phone, then the four things
// people use it for every day, then how to ask for anything, then the short setup.
type SlideKey = 'say' | 'task' | 'parts' | 'ready';
const SLIDES: SlideKey[] = ['say', 'task', 'parts', 'ready'];
const CHIP_ICONS: IconName[] = ['calendar-check-outline', 'bookmark-outline', 'wallet-outline', 'pill'];

// Where the person is, in case Android ends the app mid-introduction (low memory, a call,
// the camera). Same two-column preferences table as every other setting; removed the
// moment onboarding finishes, so it never outlives the pages it describes.
const PROGRESS_KEY = 'onboardingProgress';

const bnNum = (n: number) => String(n).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'.charAt(Number(d)));

type Styles = ReturnType<typeof makeStyles>;
type Tone = { soft: string; on: string; border: string };

export default function OnboardingScreen() {
  const { colors, accents, language, setLanguage, completeOnboarding, reduceMotion } = useAppPreferences();
  const db = useSQLiteContext();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const last = index === SLIDES.length - 1;
  // At a large font size a centred page pushes its end below the fold with nothing to say
  // there is more; starting from the top makes the cut-off line itself the cue to scroll.
  const tall = fontScale >= 1.3;

  const t = bn
    ? {
        skip: 'বাদ দিন', next: 'পরবর্তী', start: 'শুরু করুন',
        langSwitch: 'English', langSwitchLabel: 'ভাষা বদলান — English',
        welcomeTitle: 'আপনার প্রয়োজনীয় তথ্য এক জায়গায়',
        welcomeBody: 'কাজ, দরকারি তথ্য, টাকা-পয়সা আর ওষুধ — প্রতিদিনের সবকিছু গুছিয়ে রাখে "আপন"।',
        welcomeChips: ['কাজ ও রিমাইন্ডার', 'মেমোরি', 'আয়-ব্যয় ও দেনা-পাওনা', 'স্বাস্থ্য ও ওষুধ'],
        privacyLine: 'আপনার সব তথ্য শুধু এই ফোনেই থাকে — কোনো অ্যাকাউন্ট লাগে না, কোনো সার্ভারে জমা হয় না।',
        captureTitle: 'কাজ বলুন, আপন মনে রাখবে',
        captureBody: 'যেভাবে মুখে বলেন সেভাবেই লিখুন — তারিখ আর সময় অ্যাপ নিজেই বুঝে নেয়, সময় হলে রিমাইন্ডার দেয়।',
        memoryInput: 'মনে রাখো বাসার ওয়াইফাই পাসওয়ার্ড apon1234',
        moneyInput: 'বাজারে ৫০০ টাকা খরচ',
        assistantTitle: 'শুধু বলুন বা লিখুন',
        assistantBody: 'ভাসমান গোল "আপন" বোতাম চেপে বাংলায় যা দরকার লিখুন বা মাইকে বলুন — কাজ যোগ, খরচ লেখা, প্রশ্নের উত্তর, সব এক জায়গা থেকে।',
        askTitle: 'পরে শুধু জিজ্ঞেস করলেই হবে:',
        assistantExamples: ['আজ কী কী করতে হবে?', 'হাতে কত টাকা আছে?', 'পরের ওষুধ কখন?'],
        exampleInput: 'আগামীকাল সকাল ৯টায় সাপ্লায়ারকে ফোন করব',
        exTask: 'কাজ', exTaskV: 'সাপ্লায়ারকে ফোন করব', exDate: 'তারিখ', exDateV: 'আগামীকাল', exTime: 'সময়', exTimeV: 'সকাল ৯:০০',
        exDone: 'কাজ তৈরি', exDoneV: '✓ হয়ে গেছে', exRemind: 'মনে করিয়ে দেবে', exRemindV: 'আগামীকাল সকাল ৯:০০-এ',
        readyTitle: 'শুরু করার আগে',
        remLabel: 'কাজের সময় হলে রিমাইন্ডার দিন',
        remOn: 'চালু', remOff: 'পরে', remGranted: 'রিমাইন্ডার চালু হয়েছে', remDenied: 'অনুমতি দেওয়া হয়নি — সেটিংসে পরে চালু করা যাবে',
        remBlocked: 'ফোনের সেটিংসে নোটিফিকেশন বন্ধ আছে — সেখান থেকে চালু করতে হবে',
        retry: 'এখন চালু করুন', openSettings: 'সেটিংসে চালু করুন',
        demoLabel: 'ডেমো ডেটা দিয়ে শিখুন',
        demoBody: 'অ্যাপ কীভাবে কাজ করে দেখতে কিছু নমুনা কাজ, মেমোরি, টাকার হিসাব, দেনা-পাওনা ও ওষুধ যোগ হবে। পরে আরও → অ্যাপ ঠিক আছে কি না থেকে এক ট্যাপে মুছে ফেলা যায়।',
        storageNote: 'আপনার সব তথ্য শুধু এই ফোনেই থাকে। ফোন হারালেও যেন তথ্য না হারায়, মাঝে মাঝে ব্যাকআপ নিন: আরও → ব্যাকআপ।',
        seeding: 'ডেমো ডেটা যোগ হচ্ছে…',
        page: `${bnNum(SLIDES.length)}টি পাতার ${bnNum(index + 1)} নম্বর`,
      }
    : {
        skip: 'Skip', next: 'Next', start: 'Get started',
        langSwitch: 'বাংলা', langSwitchLabel: 'Change language — বাংলা',
        welcomeTitle: 'Everything you need, in one place',
        welcomeBody: 'Tasks, things to remember, money and medicines — Apon keeps your everyday life in order.',
        welcomeChips: ['Tasks & reminders', 'Memories', 'Money & debts', 'Health & medicines'],
        privacyLine: 'Everything stays only on this phone — no account needed, nothing stored on a server.',
        captureTitle: 'Say the task, Apon keeps it',
        captureBody: 'Write it the way you would say it — the app understands the date and time and reminds you when it is due.',
        memoryInput: 'remember the home wifi password apon1234',
        moneyInput: 'spent 500 taka on groceries',
        assistantTitle: 'Just say it, or type it',
        assistantBody: 'Tap the round floating "আপন" button, then type or say what you need — add a task, note a cost, ask a question, all from one place.',
        askTitle: 'Later, you can simply ask:',
        assistantExamples: ['What should I do today?', 'How much money do I have?', 'When is my next dose?'],
        exampleInput: 'call the supplier tomorrow at 9am',
        exTask: 'Task', exTaskV: 'call the supplier', exDate: 'Date', exDateV: 'Tomorrow', exTime: 'Time', exTimeV: '9:00 AM',
        exDone: 'Task created', exDoneV: '✓ done', exRemind: 'I will remind you', exRemindV: 'tomorrow at 9:00 AM',
        readyTitle: 'Before you start',
        remLabel: 'Remind me when a task is due',
        remOn: 'On', remOff: 'Later', remGranted: 'Reminders enabled', remDenied: 'Permission not granted — you can enable it later in Settings',
        remBlocked: 'Notifications are turned off in phone settings — turn them on there',
        retry: 'Turn on now', openSettings: 'Turn on in Settings',
        demoLabel: 'Learn with demo data',
        demoBody: 'Adds sample tasks, memories, money entries, debts and medicines so you can see how it works. Remove them in one tap later from More → Is the app all right.',
        storageNote: 'Everything stays only on this phone. Take a backup now and then, so nothing is lost if anything happens to the phone: More → Backup.',
        seeding: 'Adding demo data…',
        page: `Page ${index + 1} of ${SLIDES.length}`,
      };

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, next));
    setIndex(clamped);
    scroller.current?.scrollTo({ x: clamped * width, animated: !reduceMotion });
  }, [width, reduceMotion]);

  // Back steps back a page. It used to fall through to the app-wide handler, which — with
  // nothing behind onboarding in the stack — asked "leave Apon?" from the middle of the
  // introduction. On the first page it still does exactly that.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) return false;
      go(index - 1);
      return true;
    });
    return () => sub.remove();
  }, [index, go]);

  // A window resize (split screen) keeps the old scroll offset and shows half a page;
  // put the current page back in view whenever the width changes.
  const indexRef = useRef(0);
  useEffect(() => { indexRef.current = index; }, [index]);

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let alive = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', PROGRESS_KEY)
      .then((row) => {
        if (!alive || !row?.value) return;
        const saved = JSON.parse(row.value) as { step?: unknown; demo?: unknown };
        const step = typeof saved.step === 'number' && Number.isInteger(saved.step) ? Math.max(0, Math.min(SLIDES.length - 1, saved.step)) : 0;
        if (saved.demo === true) setDemoOn(true);
        if (step > 0) {
          indexRef.current = step;
          setIndex(step);
          requestAnimationFrame(() => scroller.current?.scrollTo({ x: step * width, animated: false }));
        }
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setRestored(true); });
    return () => { alive = false; };
    // Read once, on arrival — not again when the width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);
  useEffect(() => {
    if (!restored) return;
    void db.runAsync(
      'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      PROGRESS_KEY, JSON.stringify({ step: index, demo: demoOn }),
    ).catch(() => undefined);
  }, [db, restored, index, demoOn]);
  useEffect(() => { scroller.current?.scrollTo({ x: indexRef.current * width, animated: false }); }, [width]);

  // Back from the phone's settings with notifications now allowed: show the tick without
  // asking again. Read-only — this never opens a permission dialog by itself.
  useEffect(() => {
    if (remindersOn !== false) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void getPermission('notifications')?.check()
        .then((now) => { if (now === 'GRANTED') { setRemindersOn(true); setBlocked(false); } })
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [remindersOn]);

  const enableReminders = async () => {
    setBusy(true);
    try {
      await initializeNotifications();
      const result = await requestNotificationPermissionWithConsent();
      setRemindersOn(result === 'GRANTED');
      setBlocked(result === 'BLOCKED');
    } catch {
      setRemindersOn(false);
    } finally {
      setBusy(false);
    }
  };

  // Android will not show the dialog again once it has been refused for good; the only
  // way on from there is the phone's own settings page.
  const retryReminders = () => {
    if (blocked) void Linking.openSettings().catch(() => undefined);
    else void enableReminders();
  };

  const finish = async (withDemo = demoOn) => {
    if (finishing) return;
    setFinishing(true);
    try {
      if (withDemo) {
        // Best-effort: a demo-seed hiccup must never block the user from entering the app.
        try { await seedDemoData(db); } catch { /* ignore — app still opens clean */ }
      }
      await completeOnboarding();
      await db.runAsync('DELETE FROM app_preferences WHERE key = ?', PROGRESS_KEY).catch(() => undefined);
      router.replace('/');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.brand}><View style={styles.brandBadge}><AponMark size={Math.round(control.smallIconContainer * 0.75)} color={colors.onPrimary} /></View><Text style={styles.brandName}>{bn ? 'আপন' : 'Apon'}</Text></View>
        <View style={styles.topActions}>
          {/* Language from the first page, not the last: someone who reads English should not
              have to get through three Bengali pages to find the switch. */}
          <Pressable accessibilityRole="button" accessibilityLabel={t.langSwitchLabel} onPress={() => void setLanguage(bn ? 'en' : 'bn')} style={({ pressed }) => StyleSheet.flatten([styles.langTouch, pressed && styles.pressed])}>
            <View style={styles.langPill}><AppIcon name="translate" size={icon.sm} color={colors.primary} /><Text style={styles.langText}>{t.langSwitch}</Text></View>
          </Pressable>
          {/* "Skip" skips the introduction, not the choices: it lands on the setup page, where
              reminders and demo data are still one tap each. It used to finish onboarding
              outright, so a single tap in a corner decided both for good. */}
          {!last ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.skip} onPress={() => go(SLIDES.length - 1)} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.skip, pressed && styles.pressed])}>
              <Text style={styles.skipText}>{t.skip}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        onMomentumScrollEnd={(e) => {
          const at = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
          if (at !== index) setIndex(Math.max(0, Math.min(SLIDES.length - 1, at)));
        }}
        onContentSizeChange={() => { if (indexRef.current > 0) scroller.current?.scrollTo({ x: indexRef.current * width, animated: false }); }}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
      >
        {/* Three screens before the app (the user's brief): what Apon is for, what it does with
            what you said, and what else lives here. Then the setup step. */}

        {/* 1 — say or type it, and see what Apon understood. */}
        <Slide width={width} active={index === 0} top={tall} styles={styles}>
          <IconBadge name="account-voice" tone={accents.blue} styles={styles} active={index === 0} />
          <FadeUp active={index === 0}>
            <Heading title={t.assistantTitle} body={t.assistantBody} styles={styles} />
            <Example iconName="microphone-outline" text={t.exampleInput} styles={styles} color={colors.primary} />
            {/* Blue, not green: this is what Apon understood, not something that succeeded. */}
            <DemoCard tone={accents.blue} rows={[[t.exTask, t.exTaskV], [t.exDate, t.exDateV], [t.exTime, t.exTimeV]]} styles={styles} />
          </FadeUp>
        </Slide>

        {/* 2 — the task is kept with its reminder, and later you only have to ask. */}
        <Slide width={width} active={index === 1} top={tall} styles={styles}>
          <IconBadge name="calendar-check-outline" tone={accents.green} styles={styles} active={index === 1} />
          <FadeUp active={index === 1}>
            <Heading title={t.captureTitle} body={t.captureBody} styles={styles} />
            <DemoCard tone={accents.green} rows={[[t.exDone, t.exDoneV], [t.exRemind, t.exRemindV]]} styles={styles} />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.askTitle}</Text>
              <View style={styles.bubbles}>
                {t.assistantExamples.map((line) => (
                  <View key={line} style={styles.bubble}><AppIcon name="chat-question-outline" size={icon.sm} color={colors.primary} /><Text style={styles.bubbleText}>{line}</Text></View>
                ))}
              </View>
            </View>
          </FadeUp>
        </Slide>

        {/* 3 — the rest of the app, named in one line each, with two real examples. */}
        <Slide width={width} active={index === 2} top={tall} styles={styles}>
          <IconBadge name="view-grid-outline" tone={accents.purple} styles={styles} active={index === 2} />
          <FadeUp active={index === 2}>
            <Heading title={t.welcomeTitle} body={t.welcomeBody} styles={styles} />
            <View style={styles.chips}>
              {t.welcomeChips.map((label, i) => (
                <View key={label} style={styles.chip}>
                  <AppIcon name={CHIP_ICONS[i % CHIP_ICONS.length] ?? 'information-outline'} size={icon.sm} color={colors.primary} />
                  <Text style={styles.chipText}>{label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.field}>
              <Example iconName="pencil-outline" text={t.moneyInput} styles={styles} color={colors.primary} />
              <Example iconName="pencil-outline" text={t.memoryInput} styles={styles} color={colors.primary} />
            </View>
            <View style={styles.storageNote}>
              <AppIcon name="shield-lock-outline" size={icon.sm} color={accents.green.on} />
              <Text style={styles.storageNoteText}>{t.privacyLine}</Text>
            </View>
          </FadeUp>
        </Slide>

        {/* 4 — setup. It arrives the way the three pages before it do. */}
        <Slide width={width} active={index === 3} top={tall} styles={styles}>
          <IconBadge name="check-decagram-outline" tone={accents.green} styles={styles} active={index === 3} />
          <FadeUp active={index === 3}>
            <Heading title={t.readyTitle} styles={styles} />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.remLabel}</Text>
              {remindersOn === null ? (
                <View style={styles.remRow}>
                  <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t.remOn} onPress={() => void enableReminders()} style={({ pressed }) => StyleSheet.flatten([styles.remPrimary, busy && styles.disabled, pressed && styles.pressed])}>
                    <AppIcon name="bell-plus-outline" size={icon.sm} color={colors.onPrimary} /><Text style={styles.remPrimaryText}>{t.remOn}</Text>
                  </Pressable>
                  <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t.remOff} onPress={() => setRemindersOn(false)} style={({ pressed }) => StyleSheet.flatten([styles.remGhost, pressed && styles.pressed])}>
                    <Text style={styles.remGhostText}>{t.remOff}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.remNote, remindersOn ? styles.remNoteOk : styles.remNoteWarn]}>
                  <AppIcon name={remindersOn ? 'bell-check-outline' : 'information-outline'} size={icon.sm} color={remindersOn ? colors.success : colors.warning} />
                  <Text style={styles.remNoteText}>{remindersOn ? t.remGranted : blocked ? t.remBlocked : t.remDenied}</Text>
                </View>
              )}
              {/* Not granted is not final: one more try, or the settings page once Android has
                  stopped asking. */}
              {remindersOn === false ? (
                <Pressable disabled={busy} accessibilityRole="button" onPress={retryReminders} style={({ pressed }) => StyleSheet.flatten([styles.linkBtn, busy && styles.disabled, pressed && styles.pressed])}>
                  <Text style={styles.linkText}>{blocked ? t.openSettings : t.retry}</Text>
                </Pressable>
              ) : null}
              {/* UX-02: once the person has decided either way — "later" leaves their reminders
                  at exactly the same risk on these phones. */}
              {remindersOn !== null && AGGRESSIVE_OEM ? (
                <View style={[styles.remNote, styles.remNoteWarn]}>
                  <AppIcon name="battery-alert-variant-outline" size={icon.sm} color={colors.warning} />
                  <Text style={styles.remNoteText}>{bn
                    ? `${OEM_BRAND} ফোনে রিমাইন্ডার ঠিকমতো পেতে: ফোনের সেটিংসে Apon-এর Autostart চালু করুন, ব্যাকগ্রাউন্ডে চলতে দিন, আর Recent apps-এ Apon-এর কার্ড চেপে ধরে লক (🔒) করুন। বিস্তারিত: আরও → রিমাইন্ডার।`
                    : `On ${OEM_BRAND} phones, to keep reminders working: turn on Autostart for Apon, allow it to run in the background, and lock (🔒) its card in Recent apps. Details: More → Reminders.`}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.demoLabel}</Text>
              {/* One control for screen readers: the row is the switch, with its explanation as
                  the hint; the Switch inside is only the picture of it. */}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: demoOn }}
                accessibilityLabel={t.demoLabel}
                accessibilityHint={t.demoBody}
                onPress={() => setDemoOn(v => !v)}
                style={({ pressed }) => StyleSheet.flatten([styles.demoToggleRow, demoOn && styles.demoToggleRowOn, pressed && styles.pressed])}
              >
                <View style={styles.demoToggleIcon}><AppIcon name="database-plus-outline" size={icon.sm} color={demoOn ? colors.primary : colors.textMuted} /></View>
                <Text style={styles.demoToggleText}>{t.demoBody}</Text>
                <Switch
                  value={demoOn}
                  onValueChange={setDemoOn}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.onPrimary}
                />
              </Pressable>
            </View>

            <View style={styles.storageNote}>
              <AppIcon name="shield-lock-outline" size={icon.sm} color={accents.green.on} />
              <Text style={styles.storageNoteText}>{t.storageNote}</Text>
            </View>
          </FadeUp>
        </Slide>
      </ScrollView>

      {/* Clear of the phone's own navigation bar: the app's safe area covers only the top, and
          onboarding has no tab bar underneath to lift it the way other pages do. */}
      <View style={[styles.footer, { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) }]}>
        <View style={styles.dots} accessible accessibilityLabel={t.page} accessibilityLiveRegion="polite">
          {SLIDES.map((key, i) => <Dot key={key} on={i === index} styles={styles} />)}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: finishing, busy: finishing }}
          disabled={finishing}
          accessibilityLabel={last ? t.start : t.next}
          onPress={() => (last ? void finish() : go(index + 1))}
          style={({ pressed }) => StyleSheet.flatten([styles.cta, finishing && styles.disabled, pressed && styles.pressed])}
        >
          {finishing ? (
            <><ActivityIndicator color={colors.onPrimary} /><Text style={styles.ctaText}>{demoOn ? t.seeding : t.start}</Text></>
          ) : (
            <>
              <Text style={styles.ctaText}>{last ? t.start : t.next}</Text>
              <AppIcon name={last ? 'check' : 'arrow-right'} size={icon.sm} color={colors.onPrimary} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One page. Only the page on screen is visible to a screen reader — all four are mounted
 * side by side in the pager, and TalkBack used to read every one of them in a row.
 */
function Slide({ width, active, top, children, styles }: { width: number; active: boolean; top: boolean; children: React.ReactNode; styles: Styles }) {
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={[styles.slide, top && styles.slideTop]}
      showsVerticalScrollIndicator={false}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!active}
    >
      {/* One column, one width: every card on every page lines up with every other. */}
      <View style={styles.column}>{children}</View>
    </ScrollView>
  );
}

function Heading({ title, body, styles }: { title: string; body?: string; styles: Styles }) {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

/** A sentence as the person would say or type it — a quotation, not a field to fill in. */
function Example({ iconName, text, color, styles }: { iconName: IconName; text: string; color: string; styles: Styles }) {
  return (
    <View style={styles.example}>
      <AppIcon name={iconName} size={icon.sm} color={color} />
      <Text style={styles.exampleText}>{`“${text}”`}</Text>
    </View>
  );
}

function DemoCard({ tone, rows, styles }: { tone: Tone; rows: [string, string][]; styles: Styles }) {
  return (
    <View style={[styles.demoCard, { borderColor: tone.border, backgroundColor: tone.soft }]}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.demoRow}>
          <Text style={[styles.demoLabel, { color: tone.on }]}>{label}</Text>
          <Text style={styles.demoValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The entrance every page gets: each block settles in from just below, fading up, 90ms
 * after the one above it — a page being written for you rather than a sheet dropped in.
 *
 * `active` fires the animation each time a page becomes the current one — including
 * flicking back — because a first impression a user cannot return to is a poor one to
 * spend an animation on once and never again. The stagger stops growing after the
 * seventh block so a long page never keeps the person waiting.
 */
function FadeUp({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <FadeUpItem key={(isValidElement(child) && child.key) || i} active={active} delay={80 + Math.min(i, 6) * 90}>{child}</FadeUpItem>
      ))}
    </>
  );
}

function FadeUpItem({ active, delay, children }: { active: boolean; delay: number; children: React.ReactNode }) {
  const { reduceMotion } = useAppPreferences();
  // `useMemo`, not `useRef().current`: reading a ref during render is both a lint
  // error and a value nothing can drive.
  const progress = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (reduceMotion) { progress.setValue(1); return; }
    if (!active) { progress.setValue(0); return; }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [active, delay, progress, reduceMotion]);
  return (
    // Stretch to the column: a wrapper that hugged its own content made each card on a
    // page as wide as its own text, and no two edges lined up.
    <Animated.View style={{
      alignSelf: 'stretch',
      alignItems: 'center',
      opacity: progress,
      transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

/** The page dot the person is on stretches into a pill — scaleX and opacity, so it runs
 *  on the native driver and cannot stutter while the pager is still settling. */
function Dot({ on, styles }: { on: boolean; styles: Styles }) {
  const { reduceMotion } = useAppPreferences();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the starting value only; the effect below drives it.
  const progress = useMemo(() => new Animated.Value(on ? 1 : 0), []);
  useEffect(() => {
    if (reduceMotion) { progress.setValue(on ? 1 : 0); return; }
    Animated.timing(progress, { toValue: on ? 1 : 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [on, progress, reduceMotion]);
  return (
    <Animated.View style={[styles.dot, { transform: [{ scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 2.75] }) }] }]}>
      <Animated.View style={[styles.dotFill, { opacity: progress }]} />
    </Animated.View>
  );
}

function IconBadge({ name, tone, styles, active }: { name: IconName; tone: Tone; styles: Styles; active: boolean }) {
  const { reduceMotion } = useAppPreferences();
  // `useMemo`, not `useRef().current`: reading a ref during render is both a lint
  // error and a value nothing can drive.
  const progress = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (reduceMotion) { progress.setValue(1); return; }
    if (!active) { progress.setValue(0); return; }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 480, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
  }, [active, progress, reduceMotion]);
  return (
    <Animated.View style={[styles.iconBadge, { backgroundColor: tone.soft, borderColor: tone.border, opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
      <AppIcon name={name} size={icon.xl} color={tone.on} />
    </Animated.View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
    brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    brandBadge: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    brandName: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700' },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    langTouch: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    langPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: control.chipHeight, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    langText: { color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    skip: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
    skipText: { color: colors.textSecondary, ...typography.meta, fontWeight: '800' },
    pager: { flex: 1 },
    slide: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
    slideTop: { justifyContent: 'flex-start' },
    column: { width: '100%', maxWidth: layout.readableMaxWidth, alignSelf: 'center', alignItems: 'center', gap: spacing.md },
    iconBadge: { width: control.heroBadge, height: control.heroBadge, borderRadius: radius.xxl, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    heading: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
    title: { color: colors.textPrimary, ...typography.titleLarge, textAlign: 'center' },
    body: { color: colors.textSecondary, ...typography.body, textAlign: 'center' },
    example: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch', borderLeftWidth: 3, borderLeftColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
    exampleText: { flex: 1, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    demoCard: { alignSelf: 'stretch', borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
    // A fixed share for the label column, so the values on every row start at one line.
    demoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    demoLabel: { width: '36%', ...typography.caption, fontWeight: '700' },
    demoValue: { flex: 1, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    field: { alignSelf: 'stretch', gap: spacing.sm },
    fieldLabel: { color: colors.textSecondary, ...typography.label, fontWeight: '700' },
    remRow: { flexDirection: 'row', gap: spacing.sm },
    remPrimary: { flex: 1, minHeight: control.buttonHeight, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primary },
    remPrimaryText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '700' },
    remGhost: { minHeight: control.buttonHeight, minWidth: layout.minTouchTarget * 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    remGhostText: { color: colors.textSecondary, ...typography.bodySmall, fontWeight: '800' },
    remNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md },
    remNoteOk: { borderColor: accents.green.border, backgroundColor: accents.green.soft },
    remNoteWarn: { borderColor: accents.orange.border, backgroundColor: accents.orange.soft },
    remNoteText: { flex: 1, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    linkBtn: { alignSelf: 'flex-start', minHeight: layout.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.xs },
    linkText: { color: colors.primary, ...typography.callout, fontWeight: '700' },
    demoToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
    demoToggleRowOn: { borderColor: colors.primary, backgroundColor: accents.blue.soft },
    demoToggleIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    demoToggleText: { flex: 1, color: colors.textSecondary, ...typography.bodySmall },
    storageNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, alignSelf: 'stretch', borderWidth: border.thin, borderColor: accents.green.border, borderRadius: radius.lg, backgroundColor: accents.green.soft, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
    storageNoteText: { flex: 1, color: accents.green.on, ...typography.caption, fontWeight: '700' },
    chips: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
    chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.smd, minHeight: control.chipHeight, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    chipText: { color: colors.textPrimary, ...typography.caption, fontWeight: '700' },
    bubbles: { alignSelf: 'stretch', gap: spacing.xs },
    bubble: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', maxWidth: '90%', paddingHorizontal: spacing.md, paddingVertical: spacing.smd, borderRadius: radius.lg, backgroundColor: accents.blue.soft },
    bubbleText: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: border.thin, borderTopColor: colors.border },
    dots: { flexDirection: 'row', gap: spacing.xs },
    dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
    dotFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill, backgroundColor: colors.primary },
    cta: { minHeight: control.buttonHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary },
    ctaText: { color: colors.onPrimary, ...typography.callout, fontWeight: '700' },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
