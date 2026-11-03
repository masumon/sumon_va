import { useEffect, useRef, useState } from 'react';
import { Stack, router, usePathname } from 'expo-router';
import { BackHandler, Keyboard, KeyboardAvoidingView, StatusBar, useWindowDimensions } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as QuickActions from 'expo-quick-actions';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
// One file per weight, from its own folder: the packages' index requires every weight
// (18 Inter + 9 Bengali files, ~7 MB of the APK) even though only these four are used.
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_500Medium } from '@expo-google-fonts/noto-sans-bengali/500Medium';
import { NotoSansBengali_600SemiBold } from '@expo-google-fonts/noto-sans-bengali/600SemiBold';
import { NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useSQLiteContext } from 'expo-sqlite';
import { AppProviders } from '../src/app/AppProviders';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AnimatedSplash } from '../src/ui/AnimatedSplash';
import { AppConfirmDialog } from '../src/ui/AppFeedback';
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary';
import { LockGate } from '../src/ui/LockGate';
import { PrimaryNav, primaryNavItems } from '../src/ui/PrimaryNav';
import { FloatingApon } from '../src/ui/FloatingApon';
import { LlmIssueBanner } from '../src/ui/LlmIssueCard';
import { PreviewHost } from '../src/ui/ItemPreviews';
import { bindOnDeviceLlmEngine } from '../src/ai/engine/on-device-llm-engine';
import { purgeExpiredTasks } from '../src/services/task-repository';
import { purgeExpiredMemories } from '../src/services/memory-repository';
import { purgeExpiredTrash } from '../src/services/trash-registry';
import { syncQuickCaptureTile } from '../src/services/quick-capture-notification';
// Registering every module once, at the root, so Settings, Reminders, search and the
// assistant all see the same set however the user entered the app.
import '../src/modules';
import { syncDebtReminders } from '../src/services/debt/reminders';
import { recordNotificationDelivery } from '../src/services/expo-notification-adapter';
import { warnIfMonthAtRisk } from '../src/services/insight-service';
import { runAutoBackup } from '../src/services/auto-backup-service';
import { useShareIntent } from 'expo-share-intent';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { getWindowSizeClass, layout } from '../src/theme';

// Taken from the bar itself rather than typed out again. The two lists drifted apart the
// first time a module was added, and the symptom — the navigation vanishing on one
// screen — gave no hint that a second list existed.
const primaryRoutes = primaryNavItems.map((item) => item.href);

void SplashScreen.preventAutoHideAsync().catch(() => {});

// A reminder is only useful if tapping it lands on the task. This is app-wide and
// must survive cold start (getLastNotificationResponseAsync) and warm taps (listener).
function routeFromNotification(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as { taskId?: unknown; route?: unknown; params?: unknown } | undefined;
  const taskId = typeof data?.taskId === 'string' ? data.taskId : undefined;
  if (taskId) { router.push({ pathname: '/task-detail', params: { id: taskId } }); return; }
  // The persistent quick-capture tile carries a plain destination instead of a task id.
  const route = typeof data?.route === 'string' ? data.route : undefined;
  // A download notification also names the file to open (download-notification.ts).
  const params = data?.params && typeof data.params === 'object' ? data.params as Record<string, string> : undefined;
  if (route) router.push((params ? { pathname: route, params } : route) as never);
}

// `ready` must be the same `prefsLoaded` gate `AppNavigator` uses to decide whether to
// render `<Stack>` at all. A cold start from a tapped notification calls `router.push`
// before expo-router has anywhere to push to if this fires on the very first effect pass
// (device-confirmed: the app hung on the splash screen indefinitely instead of opening the
// task/debt the notification named) — the push is silently lost, and the one-shot
// `handledCold` guard means it never gets a second chance once `<Stack>` does mount.
function useNotificationRouting(ready: boolean) {
  const handledCold = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!handledCold.current) {
      handledCold.current = true;
      void Notifications.getLastNotificationResponseAsync().then(routeFromNotification).catch(() => {});
    }
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromNotification);
    return () => sub.remove();
  }, [ready]);
}

// "Delivered" now means the reminder actually arrived, not that the OS accepted it for
// later. The scheduler refuses to re-create a delivered reminder, so writing the key at
// schedule time meant a notification dropped by Doze could never be put back — it was gone
// and the app thought it had rung. Recording it here is the other half of that fix.
function useNotificationDeliveryLog(db: ReturnType<typeof useSQLiteContext>) {
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      void recordNotificationDelivery(db, notification);
    });
    return () => sub.remove();
  }, [db]);
}

// Text or a link shared to Apon from another app opens a pre-filled new task.
const NEWLINE = String.fromCharCode(10);

function useShareCapture() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  useEffect(() => {
    if (!hasShareIntent) return;
    const text = (shareIntent.text ?? '').trim();
    const url = (shareIntent.webUrl ?? '').trim();
    if (text || url) {
      const whole = (text || url).trim();
      // A title is one line; a shared paragraph is not. Keep the first line as the title
      // and put everything else where it can still be read, rather than throwing it away.
      const firstLine = whole.split(NEWLINE)[0] ?? whole;
      const title = (firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine) || whole.slice(0, 140);
      const remainder = whole.slice(title.replace(/…$/u, '').length).trim();
      const extra = [remainder, url && !whole.includes(url) ? url : ''].filter(Boolean).join(NEWLINE);
      const notes = extra || undefined;
      router.push({ pathname: '/task-editor', params: notes ? { title, notes } : { title } });
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);
}

// Long-press the launcher icon → jump straight to a new task, memory, search or assistant.
function useLauncherShortcuts() {
  const handledCold = useRef(false);
  useEffect(() => {
    const route = (action: QuickActions.Action | undefined) => {
      const href = action?.params?.href;
      if (typeof href === 'string') router.push(href as never);
    };
    void QuickActions.setItems([
      { id: 'new-task', title: 'New task', icon: 'compose', params: { href: '/task-editor' } },
      { id: 'new-memory', title: 'New memory', icon: 'compose', params: { href: '/memory-editor' } },
      { id: 'search', title: 'Search', icon: 'search', params: { href: '/search' } },
      { id: 'assistant', title: 'Apon', params: { href: '/assistant' } },
    ]).catch(() => {});
    if (!handledCold.current) { handledCold.current = true; route(QuickActions.initial); }
    const sub = QuickActions.addListener(route);
    return () => sub.remove();
  }, []);
}

function AppNavigator() {
  const { themeMode, colors, onboarded, prefsLoaded, reduceMotion, language, quickCaptureTile, blockScreenshots, appLockEnabled, autoBackup, autoBackupFolderUri, setQuickCaptureTile } = useAppPreferences();
  useNotificationRouting(prefsLoaded);
  useLauncherShortcuts();
  useShareCapture();

  const db = useSQLiteContext();
  useNotificationDeliveryLog(db);
  const pathname = usePathname();

  // A debt ledger and a memory holding a password are both fully legible in the recents
  // thumbnail the moment somebody else picks up the phone. Declarative on purpose:
  // switching it off releases the block, where the ad-hoc one the audit found outlived
  // the screen that set it and survived until the app was force-stopped.
  //
  // App Lock forces this on regardless of the separate screenshot toggle, not just while
  // it happens to also be on. LockGate only re-locks *after* the app returns to the
  // foreground -- the recents thumbnail Android captures the moment the app goes to the
  // background is whatever screen was showing right then, before any lock screen exists
  // to cover it. Someone who turned on App Lock for a debt ledger or a medical record was
  // told their data is protected; a full-resolution thumbnail of it sitting in the app
  // switcher, reachable with no PIN at all, would not be.
  useEffect(() => {
    void (blockScreenshots || appLockEnabled
      ? preventScreenCaptureAsync('apon-privacy')
      : allowScreenCaptureAsync('apon-privacy')).catch(() => {});
    return () => { void allowScreenCaptureAsync('apon-privacy').catch(() => {}); };
  }, [blockScreenshots, appLockEnabled]);

  // Android back / swipe-back: from an inner screen, navigate back as usual. Only when
  // there is nothing left to go back to (root/home) do we show a branded confirm sheet
  // before closing — "Stay" just dismisses it and keeps the screen and any unsaved
  // input intact.
  const bn = language === 'bn';
  const [exitOpen, setExitOpen] = useState(false);
  const exitOpenRef = useRef(false);
  useEffect(() => { exitOpenRef.current = exitOpen; }, [exitOpen]);
  useEffect(() => {
    const onBackPress = () => {
      if (router.canGoBack()) return false;
      if (exitOpenRef.current) return true; // already asking — swallow repeat presses
      setExitOpen(true);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, []);

  // Let the opt-in on-device LLM engine reach the installed-model record. Harmless
  // when no model or native runtime is present — the built-in rule engine stays active.
  useEffect(() => { bindOnDeviceLlmEngine(db); }, [db]);

  // Empty the trash of anything soft-deleted more than 30 days ago. Best-effort, once
  // per launch, off the critical path.
  useEffect(() => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    void Promise.resolve().then(async () => {
      try {
        await purgeExpiredTasks(db, cutoff);
        await purgeExpiredMemories(db, cutoff);
        // Every module's own soft-deletes too. Tasks and memories had their own purge and
        // the registry's did not run at all, so a deleted debt sat in the database for good
        // while Trash told the user it would go in thirty days.
        await purgeExpiredTrash(db, 30);
      } catch { /* best-effort */ }
    });
  }, [db]);

  // Reconcile the persistent quick-capture notification with its preference, and run a
  // weekly auto-backup if that is switched on. Both are opt-in, best-effort, once per launch.
  useEffect(() => {
    if (!prefsLoaded) return;
    void syncQuickCaptureTile(quickCaptureTile, language).then((ok) => {
      // If it was switched on but notification permission was refused, don't leave the
      // toggle looking active for a tile that will never show.
      if (quickCaptureTile && !ok) void setQuickCaptureTile(false);
    }).catch(() => {});
  }, [prefsLoaded, quickCaptureTile, language, setQuickCaptureTile]);
  useEffect(() => {
    if (!prefsLoaded || !autoBackup) return;
    // The weekly backup packs the whole database — started well after the first screens
    // have loaded, so it never competes with them for the one database queue.
    const t = setTimeout(() => { void runAutoBackup(db, autoBackupFolderUri).catch(() => {}); }, 20_000);
    return () => clearTimeout(t);
  }, [prefsLoaded, autoBackup, autoBackupFolderUri, db]);

  // Reconcile the debt module's due-date reminders once per launch. It cancels and
  // re-schedules only its own `dr:` notifications, so it never touches task reminders.
  useEffect(() => {
    if (!prefsLoaded) return;
    // A few seconds after launch, not during it: both share the one database queue with
    // the first screen's own reads (see SchedulerBootstrap).
    const t = setTimeout(() => {
      void syncDebtReminders(db, new Date(), language).catch(() => {});

      // And, at most once a month, tell the user if the month has stopped adding up. The
      // check is cheap and silent when nothing is wrong; the permission is checked, never
      // asked for, because a dialog raised on launch is one that gets denied for good.
      void warnIfMonthAtRisk(db, language, async (title, body) => {
        await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [db, prefsLoaded, language]);

  // First run: send the user through onboarding before anything else renders.
  useEffect(() => {
    if (prefsLoaded && !onboarded && pathname !== '/onboarding') router.replace('/onboarding');
  }, [prefsLoaded, onboarded, pathname]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const dark = themeMode === 'dark';
  const showPrimaryNav = primaryRoutes.includes(pathname);
  const windowClass = getWindowSizeClass(width);
  const expandedNav = windowClass === 'expanded';
  // While typing, the keyboard covers the tab bar; keeping the bar's room as well left an
  // empty band between the text and the keyboard on the main pages.
  const compactBottomInset = showPrimaryNav && !expandedNav && !keyboardUp ? layout.compactNavHeight + insets.bottom : 0;
  const mediumHorizontalPadding = windowClass === 'medium' ? layout.regularHorizontal : 0;

  // `appLockHash` (and so `appLockEnabled`/`locked` inside LockGate) starts out null —
  // "no lock" — until this async read of `app_preferences` resolves. The Stack below was
  // mounting unconditionally regardless, so on a cold start slow enough for the native
  // splash to have already dismissed (it runs on its own timer, unrelated to this read),
  // a user who genuinely has App Lock turned on had their real screen fully visible and
  // interactive for however long the query took — LockGate had nothing to gate yet,
  // because it did not yet know locking was supposed to be on. Holding the whole
  // navigator back until the real value is in hand closes that window outright, rather
  // than trying to guess a safe-looking placeholder to show in its place.
  if (!prefsLoaded) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      {/* The keyboard, in one place for every screen. The app draws edge-to-edge
          (edgeToEdgeEnabled), so Android's adjustResize no longer shrinks the page and the
          keyboard used to cover a form's Save bar — saving meant closing the keyboard first.
          Padding the navigator by the keyboard's height lifts every screen's bottom bar
          above it. The tab bar and floating আপন sit outside and stay put (আপন hides). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Stack
        screenOptions={{
          headerShown: false,
          animation: reduceMotion ? 'none' : 'default',
          contentStyle: {
            backgroundColor: colors.background,
            paddingBottom: compactBottomInset,
            paddingLeft: showPrimaryNav && expandedNav ? layout.expandedNavWidth : 0,
            paddingRight: showPrimaryNav && windowClass === 'medium' ? mediumHorizontalPadding : 0,
          },
        }}
      />
      </KeyboardAvoidingView>
      <PreviewHost />
      {/* আপন floats on the main pages; each module now opens its own guide (ModuleGuide). */}
      {showPrimaryNav ? <FloatingApon /> : null}
      {/* The AI's trouble, told at once on any page (আপন and the AI page show the full card). */}
      <LlmIssueBanner hidden={pathname === '/assistant' || pathname === '/ai-model'} />
      {showPrimaryNav ? <PrimaryNav /> : null}
      <LockGate>{null}</LockGate>
      <AppConfirmDialog
        visible={exitOpen}
        icon="exit-run"
        iconTone="primary"
        title={bn ? 'অ্যাপ থেকে বেরিয়ে যাবেন?' : 'Leave Apon?'}
        description={bn
          ? 'আপনার সব কাজ ও মেমোরি নিরাপদে এই ফোনেই সংরক্ষিত থাকবে — যেকোনো সময় ফিরে আসতে পারবেন।'
          : 'Every task and memory stays saved safely on this phone — you can come back anytime.'}
        cancelLabel={bn ? 'থেকে যাই' : 'Stay'}
        confirmLabel={bn ? 'বেরিয়ে যাই' : 'Leave'}
        confirmIcon="exit-run"
        onCancel={() => setExitOpen(false)}
        onConfirm={() => { setExitOpen(false); BackHandler.exitApp(); }}
      />
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSansBengali_400Regular,
    NotoSansBengali_500Medium,
    NotoSansBengali_600SemiBold,
    NotoSansBengali_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // Safety net: never let a slow/failed font fetch trap the app on a blank splash.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const canRender = fontsLoaded || Boolean(fontError) || fontTimedOut;

  // Belt-and-suspenders: AnimatedSplash dismisses itself on a timer, but if it never
  // mounts (or a refresh interrupts it), force the cover away. Runs at most once.
  const splashGuard = useRef(false);
  useEffect(() => {
    if (!canRender || splashGuard.current) return;
    splashGuard.current = true;
    const t = setTimeout(() => setSplashDone(true), 12000);
    return () => clearTimeout(t);
  }, [canRender]);

  if (!canRender) return null; // native splash (emerald + spark) stays up

  return (
    <SafeAreaProvider>
      {/* Outside the providers (B-02): a failure while opening the database or reading
          preferences now shows the recovery screen instead of a blank app. */}
      <AppErrorBoundary>
        <AppProviders>
          <AppNavigator />
          {splashDone ? null : <AnimatedSplash onFinish={() => setSplashDone(true)} />}
        </AppProviders>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
