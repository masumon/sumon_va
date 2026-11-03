import { withFabRoom } from './FloatingApon';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bangladeshMonthKey, bnDayPart, formatBangladeshWeekdayDate, zonedClock } from '../i18n/date-time';
import { ActivityIndicator, AppState as RNAppState, FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { tagLabel } from './TagSuggestions';
import Animated, { Easing, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useAppFeedback } from './AppFeedback';
import { useSQLiteContext } from 'expo-sqlite';
import { parseLocalNlp, type NlpPriority, type NlpResult } from '../ai/nlp';
import { useTaskStore } from '../store/task.store';
import { useMemoryStore } from '../store/memory.store';
import { useSubtaskStore } from '../store/subtask.store';
import { useAppPreferences } from '../app/AppPreferences';
import { getSuggestions, type Suggestion } from '../services/suggestion-service';
import { preferredIntent, recordDismissal, recordIntentChoice, suggestTime, topFrequentTasks } from '../services/learning-service';
import { getStreak } from '../services/streak-service';
import { editTask } from '../services/task-service';
import { useSpeech } from '../hooks/useSpeech';
import { voiceOfflineStatus } from '../services/voice-offline-service';
import { canReadImages, captureAndReadText, describeReader } from '../services/ocr-service';
import { AttachmentPermissionError } from '../services/attachment-service';
import { collectHomeLines, type HomeLine } from '../modules';
import { seedDemoData } from '../services/demo-data-service';
import { collectInsights, type Insight } from '../services/insight-service';
import { AponMark } from './AponMark';
// The one observation no module can make on its own, because it needs two of them:
// see `life-advice-service`.
import { monthlyAdvice } from '../services/life-advice-service';
import { enabledModules } from '../modules';
import type { AppModule } from '../modules/registry';
import { primaryNavItems } from './PrimaryNav';
import { asciiDigitsToBengali } from '../services/debt/money';
import { AppIcon, type IconName } from '../ui/AppIcon';
import { AppSkeletonList, AppState } from '../ui/AppSurface';
import { success as hapticSuccess, tapLight, warn as hapticWarn } from '../ui/haptics';
import { RowLeading } from '../ui/RowLeading';
import { HeroMark } from '../ui/HeroMark';
import { loadImageThumbs } from '../services/attachment-thumbs';
import { home } from '../i18n/common';
import { localizeTaskPriority, localizeTaskStatus } from '../i18n/domain-labels';
import { border, control, elevation, gradients, icon, layout, radius, spacing, typography, memoryKindAccentName, memoryKindIcon, type AccentRole, type ThemeAccents, type ThemeColors } from '../theme';
import type { Task, TaskRecurrence } from '../types/task-model';
import { ReminderReadinessCard } from './ReminderReadinessCard';
import { useOcrLinePicker } from './OcrLinePicker';
import { ModuleGuide } from './ModuleGuide';
import { SpellingCheck } from './SpellingCheck';
import { suggestSpelling } from '../ai/nlp/spelling';

/** Bengali numerals in Bengali. Mixing ASCII digits into a Bengali line makes Android's
 *  text measurement truncate it, which is why this exists rather than plain interpolation. */
const bnNum = (value: number, bn: boolean) => (bn ? asciiDigitsToBengali(String(value)) : String(value));

const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
// The Asia/Dhaka calendar day of an ISO timestamp — NOT `iso.slice(0,10)`, which is the
// UTC day and misfiles anything due between 00:00 and 05:59 local.
const dayKeyOf = (iso: string | null | undefined) => (iso ? dateKey(new Date(iso)) : null);
const pad = (value: number) => String(value).padStart(2, '0');
const clockLabel = (minutes: number, bn: boolean) => { const h = Math.floor(minutes / 60) % 24; const h12 = h % 12 || 12; return bn ? `${bnDayPart(h)} ${asciiDigitsToBengali(`${h12}:${pad(minutes % 60)}`)}` : `${h12}:${pad(minutes % 60)} ${h < 12 ? 'AM' : 'PM'}`; };

type NlpPlan = {
  kind: 'task' | 'memory';
  title: string;
  plannedDate: string | null;
  dueAt: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
  timeSuggested: boolean;
  priority: NlpPriority | null;
  tags: string[];
  /** "প্রতিদিন…" — repeats need a time (rc.16 test C04: Home dropped this, so it never repeated). */
  recurrence?: TaskRecurrence | null;
};

const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// A task or a memory is made here; anything else — a question, money spent, a loan, a
// health question — is আপন's to answer (the wallet/source card is there). It used to fall
// through to "কাজ তৈরি করুন" (beta audit C9).
const HOME_INTENTS: ReadonlySet<NlpResult['intent']> = new Set(['CREATE_TASK', 'CREATE_MEMORY', 'UNKNOWN']);
const asksApon = (result: NlpResult | null): boolean => Boolean(result && !HOME_INTENTS.has(result.intent));

// CREATE_MEMORY → memory, CREATE_TASK / UNKNOWN → task (with an "actually a memory" switch
// in the UI); null for what goes to আপন. `suggestedMin` comes from the on-device learning
// layer ("gym" → usually 06:00).
function buildPlan(result: NlpResult, now: Date, suggestedMin: number | null, learnedIntent: 'TASK' | 'MEMORY' | null, bn: boolean): NlpPlan | null {
  if (asksApon(result)) return null;
  const raw = (result.entities.taskText ?? result.entities.memoryText ?? result.normalizedText)?.trim();
  if (!raw) return null;
  const asMemory = result.intent === 'CREATE_MEMORY' || (result.intent === 'UNKNOWN' && learnedIntent === 'MEMORY');
  if (asMemory) {
    return { kind: 'memory', title: raw, plannedDate: null, dueAt: null, dateLabel: null, timeLabel: null, timeSuggested: false, priority: null, tags: result.entities.tags ?? [] };
  }
  let minutes = result.entities.time?.minutes;
  let timeSuggested = false;
  if (typeof minutes !== 'number' && suggestedMin !== null) { minutes = suggestedMin; timeSuggested = true; }
  let isoDate = result.entities.date?.isoDate ?? null;
  let dateResolved = Boolean(result.entities.date);
  if (!isoDate && typeof minutes === 'number') {
    const candidate = new Date(now);
    candidate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    isoDate = isoOf(candidate);
    dateResolved = true;
  }
  let dueAt: string | null = null;
  if (isoDate && typeof minutes === 'number') {
    const [y = 0, m = 1, d = 1] = isoDate.split('-').map(Number);
    dueAt = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0).toISOString();
  }
  return {
    kind: 'task',
    title: result.entities.taskText?.trim() || raw,
    plannedDate: isoDate && !dueAt ? isoDate : null,
    dueAt,
    dateLabel: dateResolved ? isoDate : null,
    timeLabel: typeof minutes === 'number' ? clockLabel(minutes, bn) : null,
    timeSuggested,
    priority: result.entities.priority ?? null,
    tags: result.entities.tags ?? [],
    recurrence: dueAt && result.entities.recurrence ? result.entities.recurrence : null,
  };
}

// Alerts that say exactly what a module's Home card says (same money, same doses).
const DUPLICATES_CARD: Record<string, string> = { 'debt-overdue': '/debt', 'health-missed': '/health' };

export default function HomeScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language, reduceMotion } = useAppPreferences();
  const bn = language === 'bn';
  const copy = useMemo(() => home(language), [language]);
  const anim = <T,>(a: T): T | undefined => (reduceMotion ? undefined : a);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  // Same reasoning as the Assistant screen's identical block: a photo's text lands in
  // this same box exactly like typed or spoken words, so it goes through the same
  // understanding rather than a separate OCR-only flow.
  const [photoChoice, setPhotoChoice] = useState(false);
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // Lines read from a photo, waiting for the person to keep the ones they want.
  const ocr = useOcrLinePicker();
  const ocrAvailable = useMemo(() => canReadImages(), []);
  const [today, setToday] = useState(() => new Date());
  const tasks = useTaskStore(s => s.tasks);
  const isLoading = useTaskStore(s => s.isLoading);
  const error = useTaskStore(s => s.error);
  const load = useTaskStore(s => s.load);
  const create = useTaskStore(s => s.create);
  const complete = useTaskStore(s => s.complete);
  const clearTaskError = useTaskStore(s => s.clearError);
  const memories = useMemoryStore(s => s.memories);
  const memoriesLoading = useMemoryStore(s => s.isLoading);
  const loadMemories = useMemoryStore(s => s.load);
  const createMemory = useMemoryStore(s => s.create);
  const subtaskProgress = useSubtaskStore(s => s.progress);
  const loadSubtaskProgress = useSubtaskStore(s => s.loadProgress);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [frequent, setFrequent] = useState<string[]>([]);
  const [streak, setStreak] = useState(0);
  const [suggestedMin, setSuggestedMin] = useState<number | null>(null);
  const [learnedIntent, setLearnedIntent] = useState<'TASK' | 'MEMORY' | null>(null);
  const [showMore, setShowMore] = useState(false);
  // Voice goes straight into the capture field: while listening we show the live
  // transcript inside the same TextInput (appended after whatever was already typed),
  // and the mic turns into a pulsing "stop". No separate overlay or recording bar.
  const { supported: voiceSupported, listening: voiceListening, partial: voicePartial, lastError: voiceError, startListening: startVoiceRec, stopListening: stopVoiceRec } = useSpeech(language);
  const { showSnackbar } = useAppFeedback();
  const [voiceBase, setVoiceBase] = useState('');
  // Asked at most once per app run: checking is a round trip to Android, and a person who
  // has read the offer does not need it repeated every time they tap the mic.
  const nudgedForPackRef = useRef(false);
  const startVoice = () => {
    const base = title.trim();
    setVoiceBase(base);
    void startVoiceRec((finalText) => setTitle((base ? base + ' ' : '') + finalText));
    // Voice still works here — the online recogniser is running. What the person cannot
    // know is that it will stop the moment the data is off, because the language pack is
    // not on the phone. Telling them at the mic, where they are already thinking about
    // voice, is the only moment this is useful; the permissions screen is where it gets
    // fixed, and one tap is the whole journey.
    if (nudgedForPackRef.current) return;
    nudgedForPackRef.current = true;
    void (async () => {
      const state = await voiceOfflineStatus(language).catch(() => null);
      if (state?.state === 'MISSING') {
        showSnackbar(
          bn ? 'ইন্টারনেট ছাড়া ভয়েস চলবে না — ভাষার প্যাকেট একবার নামিয়ে নিন' : 'Voice needs a connection until the language pack is downloaded',
          'info',
          { label: bn ? 'নামান' : 'Fetch', onPress: () => router.push('/permissions') },
        );
      } else if (state?.state === 'UNSUPPORTED') {
        // Not "not downloaded yet" — this phone's on-device speech service simply does
        // not offer this language at all (confirmed against its own reported locale
        // list), so there is nothing to fetch and no settings screen fixes it. Saying so
        // plainly beats a silent failure the next time the connection is off.
        showSnackbar(
          bn ? 'এই ফোনে বাংলা ভয়েস অফলাইনে চলে না — ইন্টারনেট ছাড়া বলে লেখা যাবে না' : 'This phone cannot recognise this language offline — speaking needs a connection here',
          'info',
        );
      }
    })();
  };
  const voiceValue = voiceListening
    ? (voiceBase ? voiceBase + ' ' : '') + voicePartial
    : title;

  const refreshSmarts = useCallback(async () => {
    try { setSuggestions(await getSuggestions(db, new Date(), language)); } catch { setSuggestions([]); }
    try { setFrequent(await topFrequentTasks(db, 4)); } catch { setFrequent([]); }
    try { setStreak(await getStreak(db)); } catch { setStreak(0); }
  }, [db, language]);

  // Swipe-down anywhere on the list re-pulls tasks, memories, subtask progress and the
  // learned "smarts" — the same work the screen does on mount.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(db), loadMemories(db), loadSubtaskProgress(db)]);
      await refreshSmarts();
    } finally { setRefreshing(false); }
  }, [db, load, loadMemories, loadSubtaskProgress, refreshSmarts]);

  useEffect(() => {
    void load(db);
    void loadMemories(db);
    void loadSubtaskProgress(db);
    void Promise.resolve().then(() => refreshSmarts());
    // Only re-render when the wall-clock minute actually changes — avoids a full
    // list rebuild every 60s when nothing time-dependent moved.
    const timer = setInterval(() => {
      setToday(prev => {
        const now = new Date();
        return now.getMinutes() === prev.getMinutes() && now.getHours() === prev.getHours() && now.getDate() === prev.getDate() ? prev : now;
      });
    }, 30000);
    const sub = RNAppState.addEventListener('change', (state) => { if (state === 'active') setToday(new Date()); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [db, load, loadMemories, loadSubtaskProgress, refreshSmarts]);

  // Learn from what the user typed: preferred task/memory intent + a habitual time.
  useEffect(() => {
    const value = title.trim();
    let active = true;
    void Promise.resolve()
      .then((): Promise<[number | null, 'TASK' | 'MEMORY' | null]> => (value.length >= 3
        ? Promise.all([suggestTime(db, value), preferredIntent(db, value)])
        : Promise.resolve([null, null])))
      .then(([min, intent]) => { if (active) { setSuggestedMin(min); setLearnedIntent(intent); } })
      .catch(() => { if (active) { setSuggestedMin(null); setLearnedIntent(null); } });
    return () => { active = false; };
  }, [db, title]);

  const todayKey = dateKey(today);
  // The hour on the app's clock (Bangladesh by default), not the phone's zone, cut at the same
  // day parts the rest of the app uses (bnDayPart): রাত ৮টার পর "শুভ রাত্রি", never "সন্ধ্যা" at 10 PM.
  const hour = Number(zonedClock(today).slice(0, 2));
  const greeting = bn
    ? (hour < 4 ? 'শুভ রাত্রি' : hour < 12 ? 'শুভ সকাল' : hour < 15 ? 'শুভ দুপুর' : hour < 18 ? 'শুভ বিকাল' : hour < 20 ? 'শুভ সন্ধ্যা' : 'শুভ রাত্রি')
    : (hour < 4 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : hour < 20 ? 'Good evening' : 'Good night');
  // Read only when sent — ➤ or the keyboard's Enter — the same rule as আপন (the user's
  // request): typing never changes the "what I understood" card. Edit the line and the card
  // goes away until it is sent again.
  const [sentText, setNlpText] = useState('');
  const nlpText = sentText && sentText === title.trim() ? sentText : '';
  const nlpPreview = useMemo<NlpResult | null>(() => (nlpText ? parseLocalNlp(nlpText, today) : null), [nlpText, today]);
  const [spellKept, setSpellKept] = useState('');
  const spelling = useMemo(() => suggestSpelling(nlpText), [nlpText]);
  const askSpelling = spelling && spellKept !== title.trim() ? spelling : null;
  const plan = useMemo(() => (nlpPreview ? buildPlan(nlpPreview, today, suggestedMin, learnedIntent, bn) : null), [nlpPreview, today, suggestedMin, learnedIntent, bn]);
  const active = useMemo(() => tasks.filter(task => !['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(task.status)), [tasks]);
  const focus = useMemo(() => ({
    overdue: active.filter(task => task.dueAt && new Date(task.dueAt).getTime() < today.getTime()).length,
    dueToday: active.filter(task => dayKeyOf(task.dueAt) === todayKey || task.plannedDate === todayKey).length,
    highPriority: active.filter(task => task.priority === 'HIGH' || task.priority === 'URGENT').length,
  }), [active, today, todayKey]);
  const todayTasks = useMemo(() => active.filter(task => {
    const overdue = Boolean(task.dueAt && new Date(task.dueAt).getTime() < today.getTime());
    return overdue || dayKeyOf(task.dueAt) === todayKey || task.plannedDate === todayKey || task.status === 'IN_PROGRESS';
  }).slice(0, 5), [active, today, todayKey]);
  const inboxCount = useMemo(() => tasks.filter(t => t.status === 'INBOX').length, [tasks]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const todayTaskIdKey = todayTasks.map(t => t.id).join(',');
  useEffect(() => {
    let alive = true;
    loadImageThumbs(db, 'TASK', todayTaskIdKey ? todayTaskIdKey.split(',') : [])
      .then(map => { if (alive) setThumbs(map); })
      .catch(() => { if (alive) setThumbs(new Map()); });
    return () => { alive = false; };
  }, [db, todayTaskIdKey]);
  const progress = useMemo(() => {
    const isToday = (task: Task) => dayKeyOf(task.dueAt) === todayKey || task.plannedDate === todayKey;
    const doneToday = tasks.filter(t => t.status === 'COMPLETED' && (dayKeyOf(t.completedAt) === todayKey || isToday(t))).length;
    const plannedToday = active.filter(isToday).length + doneToday;
    return { done: doneToday, total: plannedToday, pct: plannedToday ? Math.round((doneToday / plannedToday) * 100) : 0 };
  }, [tasks, active, todayKey]);

  // The hero (gradient + the mark + greeting) has nothing to do with the capture box, so
  // it is memoised out of the list header — otherwise every keystroke would reconcile it.
  //
  // The mark replaced a cartoon mascot that filled most of the card and said nothing. It
  // is the same ring as the app icon and the launch screen, drawn only as far as today has
  // got, so the ornament and the figure are one thing.
  const heroBlock = useMemo(() => (
    <LinearGradient colors={gradients.heroBrand} locations={[0, 0.42, 0.72, 1]} start={{ x: 0.05, y: 0 }} end={{ x: 0.95, y: 1 }} style={styles.hero}>
      <LinearGradient colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.7 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={styles.headerTop}>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.greeting}>{greeting}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.date}>{formatBangladeshWeekdayDate(today, language)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'সার্চ' : 'Search'} onPress={() => router.push('/search')} style={({ pressed }) => StyleSheet.flatten([styles.heroBell, pressed && styles.pressed])}>
          <AppIcon name="magnify" size={icon.md} color={colors.onPrimary} />
        </Pressable>
        {/* Inbox sits beside search and reminders because the three are the same kind of
            thing: places where something is waiting for you. Keeping it here means the
            bottom bar can spend its six slots on modules instead. */}
        <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ইনবক্স' : 'Inbox'} onPress={() => router.push('/inbox')} style={({ pressed }) => StyleSheet.flatten([styles.heroBell, pressed && styles.pressed])}>
          <AppIcon name="inbox-outline" size={icon.md} color={colors.onPrimary} />
          {inboxCount > 0 ? (
            <View style={styles.heroDot}>
              <Text allowFontScaling={false} style={styles.heroDotText}>
                {inboxCount > 9 ? '৯+' : bnNum(inboxCount, bn)}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'রিমাইন্ডার' : 'Reminders'} onPress={() => router.push('/reminders')} style={({ pressed }) => StyleSheet.flatten([styles.heroBell, pressed && styles.pressed])}>
          <AppIcon name="bell-outline" size={icon.md} color={colors.onPrimary} />
        </Pressable>
      </View>
      <View style={styles.heroBadge}>
        <AppIcon name="shield-check-outline" size={icon.sm} color={colors.onPrimary} />
        <Text style={styles.heroBadgeText}>{copy.offline}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bn ? 'আজকের পরিকল্পনা' : "Today's plan"}
        onPress={() => router.push('/planning')}
        style={({ pressed }) => StyleSheet.flatten([styles.heroMarkSlot, pressed && styles.pressed])}
      >
        <HeroMark
          progress={progress.total ? progress.done / progress.total : 1}
          done={progress.done}
          total={progress.total}
          language={bn ? 'bn' : 'en'}
        />
      </Pressable>
      <Text style={styles.heroPurpose}>{bn ? 'এক লাইনে লিখুন বা বলুন — বাকিটা অ্যাপ বোঝে।' : 'Write or say one line — the app does the rest.'}</Text>
    </LinearGradient>
  ), [greeting, today, language, bn, styles, colors, copy, progress, inboxCount]);

  const confirmPlan = async () => {
    if (!plan || creating || askSpelling) return;
    setCreating(true);
    try {
      if (plan.kind === 'memory') {
        if (await createMemory(db, { content: plan.title, tags: plan.tags })) { hapticSuccess(); void recordIntentChoice(db, plan.title, 'MEMORY'); setTitle(''); }
        else { hapticWarn(); showSnackbar(bn ? 'মেমোরিটি যোগ করা যায়নি।' : 'Could not save that memory.', 'danger'); }
      } else {
        const created = await create(db, { title: plan.title, plannedDate: plan.plannedDate, dueAt: plan.dueAt, priority: plan.priority ?? undefined, recurrence: plan.recurrence ?? null });
        if (created) { hapticSuccess(); void recordIntentChoice(db, plan.title, 'TASK'); setTitle(''); void refreshSmarts(); }
        else { hapticWarn(); showSnackbar(bn ? 'কাজটি যোগ করা যায়নি।' : 'Could not add that task.', 'danger'); clearTaskError(); }
      }
    } finally { setCreating(false); }
  };
  const editPlan = () => {
    if (!plan) return;
    router.push({ pathname: '/task-editor', params: { title: plan.title, ...(plan.plannedDate ? { plannedDate: plan.plannedDate } : {}), ...(plan.dueAt ? { dueAt: plan.dueAt } : {}), ...(plan.priority ? { priority: plan.priority } : {}) } });
  };
  const saveMemory = async () => {
    const value = (plan?.title ?? title).trim();
    if (!value || creating || askSpelling) return;
    setCreating(true);
    try { if (await createMemory(db, { content: value, tags: plan?.tags })) { void recordIntentChoice(db, value, 'MEMORY'); setTitle(''); } } finally { setCreating(false); }
  };
  const switchPlanToTask = async () => {
    const value = (plan?.title ?? title).trim();
    if (!value || creating || askSpelling) return;
    setCreating(true);
    try { if (await create(db, { title: value })) { void recordIntentChoice(db, value, 'TASK'); setTitle(''); void refreshSmarts(); } } finally { setCreating(false); }
  };

  const runSuggestion = async (s: Suggestion) => {
    tapLight();
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    const a = s.action;
    try {
      if (a.type === 'RESCHEDULE_OVERDUE') { for (const id of a.taskIds) await editTask(db, id, { dueAt: a.toIso }); await load(db); }
      else if (a.type === 'MAKE_RECURRING') { router.push({ pathname: '/task-editor', params: { title: a.title } }); }
      else if (a.type === 'OPEN_PLANNING') { router.push('/planning'); }
      else if (a.type === 'PREFILL_CAPTURE') { setTitle(a.text); }
      else if (a.type === 'OPEN_BACKUP') { router.push('/backup'); }
    } catch { /* best-effort */ }
    void refreshSmarts();
  };
  const dismissSuggestion = (s: Suggestion) => {
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    void recordDismissal(db, s.id).catch(() => {});
  };
  const handleComplete = useCallback(async (id: string) => {
    if (completingId) return;
    setCompletingId(id);
    try {
      const task = await complete(db, id);
      if (task) { hapticSuccess(); }
      else { hapticWarn(); showSnackbar(bn ? 'কাজটি সম্পন্ন করা যায়নি।' : 'Could not complete this task.', 'danger'); clearTaskError(); }
    } finally { setCompletingId(null); }
  }, [completingId, complete, db, showSnackbar, bn, clearTaskError]);
  const readPhoto = async (source: 'camera' | 'gallery') => {
    setPhotoChoice(false);
    if (reading) return;
    setReading(true);
    try {
      const result = await captureAndReadText(db, source, bn, true);
      if (result.cancelled) return;
      if (!result.ok || !result.text) {
        showSnackbar(result.reason ?? (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'), 'danger');
        return;
      }
      const readNote = (bn
        ? `${describeReader(result.reader!, true)} দিয়ে পড়া হয়েছে — পাঠানোর আগে দেখে নিন।`
        : `Read with ${describeReader(result.reader!, false)} — check it before sending.`) + (result.note ? ` ${result.note}` : '');
      // More than a couple of lines: the photo and its lines, to keep only the part wanted, in
      // the page's order (rc.13 QA G03). One or two lines go straight in, as before.
      setPhotoNote(readNote);
      ocr.offer(result.text, result.note ?? null, result.imageUri, (picked) => setTitle((base) => (base.trim() ? `${base.trim()}\n${picked}` : picked)));
    } catch (e) {
      showSnackbar(e instanceof AttachmentPermissionError
        ? (source === 'camera'
          ? (bn ? 'ক্যামেরার অনুমতি দেওয়া নেই।' : 'Camera permission is not granted.')
          : (bn ? 'ছবি দেখার অনুমতি দেওয়া নেই।' : 'Photo permission is not granted.'))
        : (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'), 'danger');
    } finally {
      setReading(false);
    }
  };
  const openTask = useCallback((id: string) => router.push({ pathname: '/task-detail', params: { id } }), []);
  // What each module has to say today, most urgent first. Home does not know which
  // modules exist — it asks the register, so a module added later appears here with no
  // change to this file, and one the user switched off never does.
  const [moduleLines, setModuleLines] = useState<HomeLine[]>([]);
  // What the modules say once their numbers are put together — the sentences no single
  // module could produce alone. Home is the window, so this is where they land.
  const [insights, setInsights] = useState<Insight[]>([]);
  const [modules, setModules] = useState<AppModule[]>([]);
  // A module that already has its own permanent bottom-bar tab (Health, Money) does not
  // need a second tile here too -- it was reachable in exactly one tap either way, and the
  // grid space is worth more spent on something that still takes a detour through More.
  // Debt has no tab of its own since the bottom bar was narrowed to six items, so its tile
  // stays; this reads the bar's own route list rather than naming Health/Money by hand, so
  // a future change to the bar does not leave this grid quietly duplicating a new tab.
  const primaryNavRoutes = useMemo(() => new Set(primaryNavItems.map((item) => item.href)), []);
  const homeGridModules = useMemo(() => modules.filter((module) => !primaryNavRoutes.has(module.route)), [modules, primaryNavRoutes]);

  // "Nothing here yet" is a real state, not an accident, and it deserves its own answer.
  // Judged on everything a person could have entered rather than on tasks alone: someone
  // who came for the debt ledger and never wrote a task does not have an empty app.
  const looksEmpty = tasks.length === 0 && memories.length === 0 && inboxCount === 0 && moduleLines.length === 0;
  const [seeding, setSeeding] = useState(false);
  const loadDemo = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      await seedDemoData(db);
      await onRefresh();
    } catch {
      // A demo that will not write is not worth an error dialog — the app still works.
    } finally {
      setSeeding(false);
    }
  }, [db, onRefresh, seeding]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    void collectHomeLines(db, language)
      .then((lines) => { if (alive) setModuleLines(lines); })
      .catch(() => { if (alive) setModuleLines([]); });
    void enabledModules(db)
      .then((list) => { if (alive) setModules(list); })
      .catch(() => { if (alive) setModules([]); });
    // Both kinds of observation, ranked together. A module insight knows its own table
    // deeply; a life-event one is the only thing that can see across two of them — "more
    // went out than came in" is a fact about the whole month, which no single module owns.
    // They render as the same card because to the reader they are the same kind of thing.
    void Promise.all([
      collectInsights(db, language, bangladeshMonthKey()),
      monthlyAdvice(db, language).catch(() => []),
    ])
      .then(([result, advice]) => {
        if (!alive) return;
        const crossModule: Insight[] = advice.map((a) => ({
          id: `life-${a.id}`,
          severity: a.tone === 'GOOD' ? 'GOOD' : a.tone === 'WATCH' ? 'WATCH' : 'INFO',
          title: a.text,
          detail: a.detail ?? '',
          route: '/timeline',
          from: ['life'],
          // Just above a module insight of the same severity: it saw more to say it.
          weight: a.tone === 'WATCH' ? 75 : a.tone === 'GOOD' ? 30 : 45,
        }));
        setInsights([...crossModule, ...result.insights]
          .sort((x, y) => y.weight - x.weight)
          .slice(0, 3));
      })
      .catch(() => { if (alive) setInsights([]); });
    return () => { alive = false; };
  }, [db, language]));

  const renderTask = useCallback(({ item }: { item: Task }) => (
    <TaskRow
      task={item}
      completing={completingId === item.id}
      onComplete={handleComplete}
      onOpen={openTask}
      colors={colors}
      accents={accents}
      styles={styles}
      language={language}
      subtasks={subtaskProgress[item.id]}
      thumbUri={thumbs.get(item.id)}
    />
  ), [completingId, handleComplete, openTask, colors, accents, styles, language, subtaskProgress, thumbs]);

  return (
    <View style={styles.container}>
      <FlatList keyboardDismissMode="on-drag"
        data={todayTasks}
        keyExtractor={item => item.id}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={withFabRoom(styles.content)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressBackgroundColor={colors.surface} />}
        ListHeaderComponent={
          <>
            {heroBlock}

            <View style={styles.capture}>
              <View style={styles.captureLabelRow}>
                <AppIcon name="lightning-bolt-outline" size={icon.sm} color={colors.primary} />
                <Text style={[styles.captureLabel, { flex: 1 }]}>{bn ? 'এক লাইনে লিখুন বা বলুন' : 'Write or say one line'}</Text>
                <ModuleGuide id="home" autoOpen={false} />
              </View>
              <View style={styles.composer}>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={voiceValue}
                    onChangeText={setTitle}
                    onSubmitEditing={() => { if (plan) void confirmPlan(); else if (title.trim()) setNlpText(title.trim()); }}
                    editable={!creating && !voiceListening}
                    placeholder={copy.placeholder}
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    multiline
                    style={styles.input}
                    accessibilityLabel={copy.placeholder}
                  />
                  {voiceListening ? (
                    <View style={styles.voiceTag} pointerEvents="none" accessibilityLiveRegion="polite">
                      <PulseDot color={colors.danger} reduceMotion={reduceMotion} />
                      <Text style={styles.voiceTagText}>{voicePartial.trim() ? (bn ? 'শুনছি…' : 'Listening…') : (bn ? 'বলুন…' : 'Speak…')}</Text>
                    </View>
                  ) : null}
                </View>
                {voiceSupported ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={voiceListening ? (bn ? 'থামান' : 'Stop') : (bn ? 'কথা বলুন' : 'Speak')}
                    onPress={() => { if (voiceListening) stopVoiceRec(); else startVoice(); }}
                    disabled={creating}
                    style={({ pressed }) => StyleSheet.flatten([styles.micBtn, voiceListening && styles.micBtnActive, pressed && styles.pressed])}
                  >
                    <AppIcon name={voiceListening ? 'stop' : 'microphone-outline'} size={icon.md} color={voiceListening ? colors.onPrimary : colors.primary} />
                  </Pressable>
                ) : null}
                {ocrAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: photoChoice }}
                    accessibilityLabel={bn ? 'ছবি থেকে লিখুন' : 'Write from a photo'}
                    onPress={() => setPhotoChoice((v) => !v)}
                    disabled={creating || reading}
                    style={({ pressed }) => StyleSheet.flatten([styles.micBtn, photoChoice && styles.micBtnActive, pressed && styles.pressed])}
                  >
                    {reading
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <AppIcon name="camera-outline" size={icon.md} color={photoChoice ? colors.onPrimary : colors.primary} />}
                  </Pressable>
                ) : null}
                {/* ➤ — the line is read only when sent (same rule as আপন). */}
                {title.trim() && sentText !== title.trim() && !voiceListening ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={bn ? 'পাঠান — অ্যাপ কী বুঝল দেখুন' : 'Send — see what the app understood'}
                    onPress={() => setNlpText(title.trim())}
                    disabled={creating}
                    style={({ pressed }) => StyleSheet.flatten([styles.micBtn, styles.micBtnActive, pressed && styles.pressed])}
                  >
                    <AppIcon name="send" size={icon.md} color={colors.onPrimary} />
                  </Pressable>
                ) : null}
              </View>

              {photoChoice ? (
                <View style={styles.photoRow}>
                  {([['camera', bn ? 'ছবি তুলুন' : 'Take a photo', 'camera-outline'],
                     ['gallery', bn ? 'গ্যালারি থেকে' : 'From gallery', 'image-outline']] as const).map(([source, label, iconName]) => (
                    <Pressable
                      key={source}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      onPress={() => void readPhoto(source)}
                      style={({ pressed }) => StyleSheet.flatten([styles.photoBtn, pressed && styles.pressed])}
                    >
                      <AppIcon name={iconName} size={icon.sm} color={colors.primary} />
                      <Text numberOfLines={1} style={styles.photoBtnText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {photoNote ? (
                <View style={styles.photoNote}>
                  <AppIcon name="information-outline" size={icon.xs} color={colors.textMuted} />
                  <Text style={styles.photoNoteText}>{photoNote}</Text>
                </View>
              ) : null}

              {!voiceListening && (voiceError === 'permission' || voiceError === 'unavailable' || voiceError === 'network') ? (
                <Pressable
                  accessibilityRole={voiceError === 'unavailable' ? 'text' : 'button'}
                  onPress={
                    voiceError === 'permission' ? () => void Linking.openSettings().catch(() => {})
                      : voiceError === 'network' ? () => router.push('/permissions')
                        : undefined
                  }
                  style={styles.voiceNote}
                >
                  <AppIcon
                    name={voiceError === 'permission' ? 'microphone-off' : voiceError === 'network' ? 'download-outline' : 'microphone-question'}
                    size={icon.xs}
                    color={accents.orange.on}
                  />
                  <Text style={styles.voiceNoteText}>
                    {voiceError === 'permission'
                      ? (bn ? 'মাইক্রোফোনের অনুমতি বন্ধ — চালু করতে সেটিংসে যান' : 'Microphone permission is off — tap to open Settings')
                      // This is the "no internet" case, and the fix is a one-time download,
                      // not a broken device — saying "not available" here was simply wrong.
                      : voiceError === 'network'
                        ? (bn ? 'অফলাইনে বলে লেখা এই মুহূর্তে যাচ্ছে না — বিস্তারিত ও সমাধান দেখতে চাপুন' : 'Speaking with no connection isn’t working right now — tap to see why and what to do')
                        : (bn ? 'এই ফোনে ভয়েস চালু হয়নি — টাইপ করে লিখুন' : 'Voice isn’t available here — please type instead')}
                  </Text>
                </Pressable>
              ) : null}

              {/* "সকাব ৯টায়" → "সকাল?" — asked before anything is saved (spelling.ts). */}
              {askSpelling ? <SpellingCheck suggestion={askSpelling} onAccept={(fixed) => { setTitle(fixed); setNlpText(fixed); }} onKeep={() => setSpellKept(title.trim())} /> : null}

              {plan ? (
                <View style={[styles.understand, plan.kind === 'memory' && { borderColor: accents.purple.border, backgroundColor: accents.purple.soft }]}>
                  <View style={styles.understandHead}>
                    <AppIcon name={plan.kind === 'memory' ? 'bookmark-plus-outline' : 'check-decagram-outline'} size={icon.sm} color={plan.kind === 'memory' ? accents.purple.on : accents.green.on} />
                    <Text style={[styles.understandTitle, plan.kind === 'memory' && { color: accents.purple.on }]}>{bn ? 'আমি বুঝেছি' : 'Here’s what I understood'}</Text>
                  </View>
                  <UnderstandRow icon="clipboard-text-outline" iconColor={plan.kind === 'memory' ? accents.purple.on : accents.green.on} label={plan.kind === 'memory' ? (bn ? 'মেমোরি' : 'Memory') : (bn ? 'কাজ' : 'Task')} value={plan.title} styles={styles} />
                  {plan.dateLabel ? <UnderstandRow icon="calendar-month-outline" iconColor={accents.green.on} label={bn ? 'তারিখ' : 'Date'} value={plan.dateLabel} styles={styles} /> : null}
                  {plan.recurrence ? <UnderstandRow icon="repeat" iconColor={accents.green.on} label={bn ? 'বারবার' : 'Repeats'} value={bn ? ({ DAILY: 'প্রতিদিন', WEEKDAYS: 'সপ্তাহের কাজের দিনে (রবি–বৃহস্পতি)', WEEKLY: 'প্রতি সপ্তাহে', MONTHLY: 'প্রতি মাসে' } as const)[plan.recurrence] : plan.recurrence.toLowerCase()} styles={styles} /> : null}
                  {plan.timeLabel ? <UnderstandRow icon="clock-outline" iconColor={accents.green.on} label={bn ? 'সময়' : 'Time'} value={plan.timeSuggested ? `${plan.timeLabel} ${bn ? '(সাধারণত)' : '(usual)'}` : plan.timeLabel} styles={styles} /> : null}
                  {plan.priority && plan.priority !== 'MEDIUM' ? <UnderstandRow icon="flag-variant-outline" iconColor={accents.orange.on} label={bn ? 'অগ্রাধিকার' : 'Priority'} value={localizeTaskPriority(plan.priority, bn)} styles={styles} /> : null}
                  {plan.tags.length ? <UnderstandRow icon="tag-outline" iconColor={accents.blue.on} label={bn ? 'ট্যাগ' : 'Tags'} value={plan.tags.map(t => `#${tagLabel(t, bn)}`).join(' ')} styles={styles} /> : null}
                  <Pressable disabled={creating} accessibilityRole="button" accessibilityState={{ busy: creating }} accessibilityLabel={plan.kind === 'memory' ? (bn ? 'মেমোরি সংরক্ষণ করুন' : 'Save memory') : (bn ? 'কাজ তৈরি করুন' : 'Create task')} onPress={() => void confirmPlan()} style={({ pressed }) => StyleSheet.flatten([styles.confirmBtn, plan.kind === 'memory' && { backgroundColor: accents.purple.base }, creating && styles.disabled, pressed && styles.pressed])}>
                    {creating ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="check" size={icon.sm} color={colors.onPrimary} /><Text style={styles.confirmText}>{plan.kind === 'memory' ? (bn ? 'মেমোরি সংরক্ষণ করুন' : 'Save memory') : (bn ? 'কাজ তৈরি করুন' : 'Create task')}</Text></>}
                  </Pressable>
                  <View style={styles.understandActions}>
                    {plan.kind === 'task' ? (
                      <Pressable disabled={creating} accessibilityRole="button" accessibilityLabel={bn ? 'বরং মেমোরি হিসেবে রাখুন' : 'Keep as a memory instead'} onPress={() => void saveMemory()} style={({ pressed }) => StyleSheet.flatten([styles.altBtn, { borderColor: accents.purple.border, backgroundColor: accents.purple.soft }, pressed && styles.pressed])}>
                        <AppIcon name="bookmark-plus-outline" size={icon.xs} color={accents.purple.on} />
                        <Text numberOfLines={2} style={[styles.altText, { color: accents.purple.on }]}>{bn ? 'মেমোরিতে বদলান' : 'Make it a memory'}</Text>
                      </Pressable>
                    ) : (
                      <Pressable disabled={creating} accessibilityRole="button" accessibilityLabel={bn ? 'বরং কাজ হিসেবে রাখুন' : 'Keep as a task instead'} onPress={() => void switchPlanToTask()} style={({ pressed }) => StyleSheet.flatten([styles.altBtn, { borderColor: accents.green.border, backgroundColor: accents.green.soft }, pressed && styles.pressed])}>
                        <AppIcon name="clipboard-check-outline" size={icon.xs} color={accents.green.on} />
                        <Text numberOfLines={2} style={[styles.altText, { color: accents.green.on }]}>{bn ? 'কাজে বদলান' : 'Make it a task'}</Text>
                      </Pressable>
                    )}
                    <Pressable disabled={creating} accessibilityRole="button" accessibilityLabel={bn ? 'এডিট করুন' : 'Edit'} onPress={editPlan} style={({ pressed }) => StyleSheet.flatten([styles.ghostBtn, pressed && styles.pressed])}>
                      <AppIcon name="pencil-outline" size={icon.xs} color={colors.primary} />
                      <Text numberOfLines={1} style={styles.ghostText}>{bn ? 'এডিট' : 'Edit'}</Text>
                    </Pressable>
                    <Pressable disabled={creating} accessibilityRole="button" accessibilityLabel={bn ? 'বাতিল' : 'Cancel'} onPress={() => setTitle('')} style={({ pressed }) => StyleSheet.flatten([styles.iconGhost, pressed && styles.pressed])}>
                      <AppIcon name="close" size={icon.sm} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={[styles.understandHint, plan.kind === 'memory' && { color: accents.purple.on }]}>{copy.preview}</Text>
                </View>
              ) : asksApon(nlpPreview) ? (
                // A question, money or a loan: আপন answers it, with its wallet/source card for money.
                <View style={styles.understand}>
                  <View style={styles.understandHead}>
                    <AponMark size={icon.sm + 6} color={accents.green.on} />
                    <Text style={styles.understandTitle}>{bn ? 'এটা আপনকে জিজ্ঞেস করুন' : 'Ask আপন this'}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask Apon'} onPress={() => { router.push({ pathname: '/assistant', params: { q: nlpText } }); setTitle(''); }} style={({ pressed }) => StyleSheet.flatten([styles.confirmBtn, pressed && styles.pressed])}>
                    <AppIcon name="send" size={icon.sm} color={colors.onPrimary} />
                    <Text style={styles.confirmText}>{bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask Apon'}</Text>
                  </Pressable>
                  <Text style={styles.understandHint}>{bn ? 'প্রশ্ন, টাকার হিসাব আর ধার-দেনা আপন বুঝে নেয় — কিছু রাখার আগে আপনাকে দেখায়।' : 'Questions, money and loans go to আপন — it shows you before anything is saved.'}</Text>
                </View>
              ) : null}

              <View style={styles.captureTools}>
                {!voiceSupported ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'কথা বলুন' : 'Speak'} onPress={() => router.push({ pathname: '/assistant', params: { voice: '1' } })} style={({ pressed }) => StyleSheet.flatten([styles.toolBtn, pressed && styles.pressed])}>
                    <AppIcon name="microphone-outline" size={icon.sm} color={colors.primary} />
                    <Text style={styles.toolText}>{bn ? 'বলুন' : 'Speak'}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask আপন'} onPress={() => router.push('/assistant')} style={({ pressed }) => StyleSheet.flatten([styles.toolBtn, pressed && styles.pressed])}>
                  <AponMark size={icon.sm + 6} color={colors.primary} />
                  <Text style={styles.toolText}>{bn ? 'আপন' : 'Apon'}</Text>
                </Pressable>
              </View>

              {!title.trim() && frequent.length ? (
                <View style={styles.freqRow}>
                  {frequent.map(f => (
                    <Pressable key={f} accessibilityRole="button" accessibilityLabel={f} onPress={() => setTitle(f)} style={({ pressed }) => StyleSheet.flatten([styles.freqChip, pressed && styles.pressed])}>
                      <AppIcon name="history" size={icon.xs} color={colors.textSecondary} />
                      <Text numberOfLines={1} style={styles.freqText}>{f}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            {error ? <Text accessibilityRole="alert" style={styles.error}>{copy.taskLoadError}</Text> : null}


            {/* Only while something is missing for reminders on this phone; it informs, never asks by itself. */}
            <ReminderReadinessCard />

            {/* The progress card was the one thing on Home that looked like every other
                tappable card and did nothing. It is about today, so it opens today. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={bn ? 'আজকের পরিকল্পনা খুলুন' : "Open today's plan"}
              onPress={() => router.push('/planning')}
              style={({ pressed }) => StyleSheet.flatten([styles.psychCard, pressed && styles.pressed])}
            >
              <View style={styles.progressHead}>
                <Text numberOfLines={1} style={styles.psychTitle}>{bn ? 'আজকের অগ্রগতি' : "Today's progress"}</Text>
                <View style={styles.progressRight}>
                  {streak >= 2 ? (
                    <View style={styles.streakChip} accessibilityLabel={bn ? `${asciiDigitsToBengali(String(streak))} দিন ধারাবাহিক` : `${streak} day streak`}>
                      <AppIcon name="fire" size={icon.xs} color={colors.accent} />
                      <Text style={styles.streakText}>{streak}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.progressCount}>{bnNum(progress.done, bn)}/{bnNum(progress.total || 0, bn)}</Text>
                </View>
              </View>
              <View
                style={styles.progressTrack}
                accessibilityRole="progressbar"
                accessibilityLabel={bn ? 'আজকের অগ্রগতি' : "Today's progress"}
                accessibilityValue={{ min: 0, max: progress.total || 0, now: progress.done, text: `${progress.done} / ${progress.total || 0}` }}
              >
                <Animated.View layout={anim(LinearTransition.duration(400))} style={[styles.progressFill, { width: `${progress.total ? progress.pct : 0}%` }]} />
              </View>
              <Text style={styles.psychText}>
                {progress.total === 0
                  ? (bn ? 'আজকের জন্য কিছু যোগ করুন — উপরের বক্সে লিখুন।' : 'Add something for today — use the box above.')
                  : progress.done >= progress.total
                    ? (bn ? 'দারুণ! আজকের সব কাজ শেষ। 🎉' : 'All done for today. Nice work. 🎉')
                    : (bn ? `আর ${bnNum(progress.total - progress.done, true)}টি বাকি — চালিয়ে যান।` : `${bnNum(progress.total - progress.done, bn)} to go — keep going.`)}
              </Text>
            </Pressable>

            {/* ── What this app is ─────────────────────────────────────────────
                Shown only while there is nothing to show instead. An empty app is the
                one moment a person genuinely does not know what they are looking at,
                and a grid of empty tiles does not tell them; a sentence and a demo do.
                The moment they have their own data, this gets out of the way. */}
            {looksEmpty ? (
              <View style={styles.welcome}>
                <Text style={styles.welcomeTitle}>{bn ? 'আপন — আপনার নিজের খাতা' : 'Apon — a book for your own life'}</Text>
                <Text style={styles.welcomeBody}>
                  {bn
                    ? 'কাজ আর মনে রাখার কথা, দেনা-পাওনা, আয়-ব্যয়, ওষুধ আর ডাক্তার — সব এক জায়গায়। পুরোটাই এই ফোনে, কোনো সার্ভারে যায় না, ইন্টারনেট ছাড়াই চলে।'
                    : 'Tasks and things to remember, debts, money, medicines and doctors — all in one place. All of it on this phone, sent to no server, working with no internet.'}
                </Text>
                <View style={styles.welcomeRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={bn ? 'ডেমো ডেটা দেখুন' : 'Show me a demo'}
                    disabled={seeding}
                    onPress={() => void loadDemo()}
                    style={({ pressed }) => StyleSheet.flatten([styles.welcomePrimary, (pressed || seeding) && styles.pressed])}
                  >
                    <AppIcon name={seeding ? 'progress-clock' : 'play-circle-outline'} size={icon.sm} color={colors.onPrimary} />
                    <Text numberOfLines={1} style={styles.welcomePrimaryText}>
                      {seeding ? (bn ? 'তৈরি হচ্ছে…' : 'Filling…') : (bn ? 'ডেমো দিয়ে দেখুন' : 'Try it with a demo')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask Apon'}
                    onPress={() => router.push('/assistant')}
                    style={({ pressed }) => StyleSheet.flatten([styles.welcomeSecondary, pressed && styles.pressed])}
                  >
                    <Text numberOfLines={1} style={styles.welcomeSecondaryText}>{bn ? 'আপনকে জিজ্ঞেস করুন' : 'Ask Apon'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {homeGridModules.length ? (
              <View style={styles.moduleGrid}>
                {homeGridModules.map((module) => {
                  const tone = accents[module.tone];
                  return (
                    <Pressable
                      key={module.id}
                      accessibilityRole="button"
                      accessibilityLabel={module.title(language)}
                      onPress={() => router.push(module.route as never)}
                      style={({ pressed }) => StyleSheet.flatten([styles.moduleTile, pressed && styles.pressed])}
                    >
                      <View style={[styles.moduleIcon, { backgroundColor: tone.soft }]}>
                        <AppIcon name={module.icon} size={icon.md} color={tone.on} />
                      </View>
                      <Text numberOfLines={2} style={styles.moduleLabel}>{module.title(language)}</Text>
                    </Pressable>
                  );
                })}
                {/* Health and Money already got a permanent tab when the bottom bar was
                    narrowed to six items; these two take the grid space that freed up --
                    both a detour through More before, both genuinely time-sensitive now. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'রিমাইন্ডার' : 'Reminders'}
                  onPress={() => router.push('/reminders' as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.moduleTile, pressed && styles.pressed])}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: accents.yellow.soft }]}>
                    <AppIcon name="bell-ring-outline" size={icon.md} color={accents.yellow.on} />
                  </View>
                  <Text numberOfLines={1} style={styles.moduleLabel}>{bn ? 'রিমাইন্ডার' : 'Reminders'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'ফোকাস' : 'Focus'}
                  onPress={() => router.push('/focus' as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.moduleTile, pressed && styles.pressed])}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: accents.orange.soft }]}>
                    <AppIcon name="timer-outline" size={icon.md} color={accents.orange.on} />
                  </View>
                  <Text numberOfLines={1} style={styles.moduleLabel}>{bn ? 'ফোকাস' : 'Focus'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'মানুষ' : 'People'}
                  onPress={() => router.push('/people' as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.moduleTile, pressed && styles.pressed])}
                >
                  <View style={[styles.moduleIcon, { backgroundColor: accents.purple.soft }]}>
                    <AppIcon name="account-multiple-outline" size={icon.md} color={accents.purple.on} />
                  </View>
                  <Text numberOfLines={1} style={styles.moduleLabel}>{bn ? 'মানুষ' : 'People'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={bn ? 'ব্যাকআপ' : 'Backup'}
                  onPress={() => router.push('/backup')}
                  style={({ pressed }) => StyleSheet.flatten([styles.moduleTile, pressed && styles.pressed])}
                >
                  {/* 'আরও' now has its own tab; its tile became Backup — the one safety step people forget. */}
                  <View style={[styles.moduleIcon, { backgroundColor: accents.blue.soft }]}>
                    <AppIcon name="database-lock-outline" size={icon.md} color={accents.blue.on} />
                  </View>
                  <Text numberOfLines={1} style={styles.moduleLabel}>{bn ? 'ব্যাকআপ' : 'Backup'}</Text>
                </Pressable>
                {/* No invisible spacers (rc.7): the last row's tiles share the row evenly instead of
                    leaving an empty slot, the same as the debt page's buttons. */}
              </View>
            ) : null}

            {/* An alert that only repeats a card already on Home is left out (rc.7, the user's
                choice): the card is the one that opens the details. */}
            {insights.filter((insight) => !(DUPLICATES_CARD[insight.id] && moduleLines.some((l) => l.route === DUPLICATES_CARD[insight.id]))).map((insight) => {
              const tone = insight.severity === 'RISK' ? accents.red
                : insight.severity === 'WATCH' ? accents.orange
                : insight.severity === 'GOOD' ? accents.green
                : accents.blue;
              const glyph = insight.severity === 'RISK' ? 'alert-circle-outline'
                : insight.severity === 'WATCH' ? 'alert-outline'
                : insight.severity === 'GOOD' ? 'check-circle-outline'
                : 'lightbulb-on-outline';
              return (
                <Pressable
                  key={insight.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${insight.title}. ${insight.detail}`}
                  onPress={() => insight.route && router.push(insight.route as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.insightCard, { borderColor: tone.border, backgroundColor: tone.soft }, pressed && styles.pressed])}
                >
                  <View style={styles.insightTop}>
                    <AppIcon name={glyph} size={icon.sm} color={tone.on} />
                    <Text numberOfLines={2} style={[styles.insightTitle, { color: tone.on }]}>{insight.title}</Text>
                  </View>
                  <Text style={styles.insightDetail}>{insight.detail}</Text>
                </Pressable>
              );
            })}

            {moduleLines.map((line) => {
              const tone = accents[line.tone ?? 'red'];
              return (
                <Pressable
                  key={`${line.route}:${line.label}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${line.label} ${line.value}`}
                  onPress={() => router.push(line.route as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.debtCard, { borderColor: tone.border, backgroundColor: tone.soft }, pressed && styles.pressed])}
                >
                  <View style={styles.debtIcon}>
                    <AppIcon name={line.icon ?? 'circle-slice-8'} size={icon.md} color={tone.on} />
                  </View>
                  <View style={styles.debtBody}>
                    <Text numberOfLines={1} style={styles.debtLabel}>{line.label}</Text>
                    <Text numberOfLines={1} style={[styles.debtValue, { color: tone.on }]}>{line.value}</Text>
                    {line.hint ? <Text numberOfLines={1} style={styles.debtHint}>{line.hint}</Text> : null}
                  </View>
                  <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
                </Pressable>
              );
            })}

            {suggestions.map((s, i) => (
              <Animated.View key={s.id} entering={anim(FadeInDown.delay(i * 60).duration(240))} style={styles.suggestCard}>
                <View style={styles.suggestIcon}><AppIcon name={s.icon} size={icon.md} color={accents.blue.on} /></View>
                <Text style={styles.suggestText}>{s.message}</Text>
                <View style={styles.suggestActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={s.actionLabel} onPress={() => void runSuggestion(s)} style={({ pressed }) => StyleSheet.flatten([styles.suggestGo, pressed && styles.pressed])}>
                    <Text numberOfLines={2} style={styles.suggestGoText}>{s.actionLabel}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'বাতিল' : 'Dismiss'} onPress={() => dismissSuggestion(s)} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.suggestX, pressed && styles.pressed])}>
                    <AppIcon name="close" size={icon.sm} color={colors.textMuted} />
                  </Pressable>
                </View>
              </Animated.View>
            ))}

            <SectionHeader title={copy.tasks} action={todayTasks.length || active.length ? copy.view : undefined} onPress={todayTasks.length || active.length ? () => router.push('/planning') : undefined} styles={styles} colors={colors} />
            {todayTasks.length ? <Text style={styles.sectionHint}>{copy.tasksHint}</Text> : null}
          </>
        }
        renderItem={renderTask}
        ListEmptyComponent={isLoading
          ? <AppSkeletonList rows={4} />
          : <AppState
              icon="white-balance-sunny"
              title={copy.emptyTask}
              description={copy.emptyTaskHint}
              actionLabel={tasks.length ? undefined : (bn ? 'ডেমো ডেটা দিয়ে দেখুন' : 'Explore with demo data')}
              onAction={tasks.length ? undefined : () => router.push('/diagnostics')}
            />}
        ListFooterComponent={
          <>
            <View style={styles.moreWrap}>
              {!showMore ? <LinearGradient colors={[`${colors.background}00`, colors.background]} style={styles.moreFade} pointerEvents="none" /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showMore }}
                accessibilityLabel={showMore ? (bn ? 'কম দেখান' : 'Show less') : (bn ? 'আরও দেখান' : 'Show more')}
                onPress={() => setShowMore(v => !v)}
                style={({ pressed }) => StyleSheet.flatten([styles.moreToggle, pressed && styles.pressed])}
              >
                <AppIcon name={showMore ? 'chevron-up' : 'chevron-down'} size={icon.sm} color={colors.primary} />
                <Text numberOfLines={1} style={styles.moreToggleText}>{showMore ? (bn ? 'কম দেখান' : 'Show less') : (bn ? 'আরও দেখান' : 'Show more')}</Text>
                <AppIcon name={showMore ? 'chevron-up' : 'chevron-down'} size={icon.sm} color={colors.primary} />
              </Pressable>
            </View>
            {!showMore ? null : <>
            <SectionHeader title={copy.focus} action={copy.plan} onPress={() => router.push('/planning')} styles={styles} colors={colors} />
            <View style={styles.focusGrid}>
              <FocusCard label={copy.overdue} value={focus.overdue} iconName="alert-circle-outline" tone={accents.red} onPress={() => router.push({ pathname: '/planning', params: { filter: 'overdue' } })} styles={styles} />
              <FocusCard label={copy.due} value={focus.dueToday} iconName="calendar-check-outline" tone={accents.blue} onPress={() => router.push({ pathname: '/planning', params: { filter: 'due' } })} styles={styles} />
              <FocusCard label={copy.high} value={focus.highPriority} iconName="flag-variant-outline" tone={accents.orange} onPress={() => router.push({ pathname: '/planning', params: { filter: 'high' } })} styles={styles} />
            </View>
            <SectionHeader title={copy.memories} action={copy.view} onPress={() => router.push('/memory')} styles={styles} colors={colors} />
            {memoriesLoading ? (
              <AppState loading title={copy.loadMemories} />
            ) : memories.slice(0, 3).length ? (
              memories.slice(0, 3).map(memory => {
                const tone = accents[memoryKindAccentName(memory.kind)];
                return (
                  <Pressable
                    key={memory.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${copy.openMemory} ${memory.content.slice(0, 60)}`}
                    onPress={() => router.push({ pathname: '/memory-detail', params: { id: memory.id } })}
                    style={({ pressed }) => StyleSheet.flatten([styles.memoryCard, pressed && styles.pressed])}
                  >
                    <View style={[styles.memoryIcon, { backgroundColor: tone.soft }]}>
                      <AppIcon name={memoryKindIcon(memory.kind)} size={icon.md} color={tone.on} />
                    </View>
                    <Text numberOfLines={2} style={styles.memoryTitle}>{memory.content}</Text>
                    <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
                  </Pressable>
                );
              })
            ) : (
              <AppState icon="bookmark-outline" title={copy.emptyMemory} description={copy.emptyMemory} />
            )}
            <SectionHeader title={copy.more} action={copy.open} onPress={() => router.push('/more')} styles={styles} colors={colors} />
            <View style={styles.quickRow}>
              <QuickAction icon="magnify" label={bn ? 'সার্চ' : 'Search'} onPress={() => router.push('/search')} tone={accents.blue} styles={styles} />
              <QuickAction icon="calendar-month-outline" label={bn ? 'পরিকল্পনা' : 'Planning'} onPress={() => router.push('/planning')} tone={accents.green} styles={styles} />
              <QuickAction icon="inbox-arrow-down-outline" label={`${bn ? 'ইনবক্স' : 'Inbox'}${inboxCount ? ` (${inboxCount})` : ''}`} onPress={() => router.push('/inbox')} tone={accents.orange} styles={styles} />
            </View>
            </>}
          </>
        }
      />
      {ocr.picker}
    </View>
  );
}

function SectionHeader({ title, action, onPress, styles, colors }: { title: string; action?: string; onPress?: () => void; styles: ReturnType<typeof makeStyles>; colors: ThemeColors }) {
  return (
    <View style={styles.sectionHeader}>
      <Text numberOfLines={1} style={styles.sectionTitle}>{title}</Text>
      {action && onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onPress} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.textAction, pressed && styles.pressed])}>
          <Text style={styles.textActionText}>{action}</Text>
          <AppIcon name="chevron-right" size={icon.sm} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function UnderstandRow({ icon: iconName, iconColor, label, value, styles }: { icon: IconName; iconColor: string; label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.understandRow}>
      <AppIcon name={iconName} size={icon.sm} color={iconColor} />
      <Text style={styles.understandRowLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.understandRowValue}>{value}</Text>
    </View>
  );
}

function FocusCard({ label, value, iconName, tone, onPress, styles }: { label: string; value: number; iconName: 'alert-circle-outline' | 'calendar-check-outline' | 'flag-variant-outline'; tone: AccentRole; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => StyleSheet.flatten([styles.focusCard, { borderColor: tone.border, backgroundColor: tone.soft }, pressed && styles.pressed])}>
      <View style={[styles.focusIcon, { backgroundColor: tone.border }]}>
        <AppIcon name={iconName} size={icon.sm} color={tone.on} />
      </View>
      <Text style={[styles.focusValue, { color: tone.on }]}>{value}</Text>
      <Text numberOfLines={2} style={[styles.focusLabel, { color: tone.on }]}>{label}</Text>
    </Pressable>
  );
}

function QuickAction({ icon: iconName, label, onPress, tone, styles }: { icon: IconName; label: string; onPress: () => void; tone: AccentRole; styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => StyleSheet.flatten([styles.quickAction, { borderColor: tone.border, backgroundColor: tone.soft }, pressed && styles.pressed])}>
      <AppIcon name={iconName} size={icon.md} color={tone.on} />
      <Text numberOfLines={1} style={[styles.quickLabel, { color: tone.on }]}>{label}</Text>
    </Pressable>
  );
}

const TaskRow = memo(function TaskRow({ task, completing, onComplete, onOpen, colors, accents, styles, language, subtasks, thumbUri }: { task: Task; completing: boolean; onComplete: (id: string) => void; onOpen: (id: string) => void; colors: ThemeColors; accents: ThemeAccents; styles: ReturnType<typeof makeStyles>; language: 'bn' | 'en'; subtasks?: { done: number; total: number }; thumbUri?: string }) {
  const completed = task.status === 'COMPLETED';
  const bn = language === 'bn';
  const tone = task.priority === 'URGENT' ? 'red' : task.priority === 'HIGH' ? 'orange' : 'green';
  // The empty checkbox carries the task's priority colour so the row's urgency reads at
  // a glance (red = urgent, orange = high, green = normal) — and still says "tap to tick".
  const toneOn = accents[tone].on;
  return (
    <View style={styles.taskRow}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed, busy: completing }}
        accessibilityLabel={`${bn ? 'কাজটি সম্পন্ন করুন:' : 'Mark as done:'} ${task.title}`}
        disabled={completed || completing}
        onPress={() => onComplete(task.id)}
        style={({ pressed }) => StyleSheet.flatten([styles.checkbox, !completed && { borderColor: toneOn }, completed && styles.checkboxDone, completing && styles.disabled, pressed && styles.pressed])}
      >
        {completing ? <ActivityIndicator size="small" color={colors.primary} /> : completed ? <AppIcon name="check" size={icon.sm} color={colors.onPrimary} /> : <AppIcon name="circle-outline" size={icon.sm} color={toneOn} />}
      </Pressable>
      <RowLeading thumbUri={thumbUri} icon="clipboard-text-outline" tone={tone} size={42} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${bn ? 'কাজ খুলুন' : 'Open task'} ${task.title}`} onPress={() => onOpen(task.id)} style={({ pressed }) => StyleSheet.flatten([styles.taskBody, pressed && styles.pressed])}>
        <Text numberOfLines={3} style={styles.taskTitle}>{task.title}</Text>
        <View style={styles.taskMetaRow}>
          <Text style={styles.taskMeta}>{localizeTaskPriority(task.priority, bn)} · {localizeTaskStatus(task.status, bn)}</Text>
          {subtasks && subtasks.total > 0 ? (
            <View style={styles.stepChip} accessibilityLabel={bn ? `${bnNum(subtasks.done, bn)}/${bnNum(subtasks.total, bn)} ধাপ` : `${bnNum(subtasks.done, bn)} of ${bnNum(subtasks.total, bn)} steps`}>
              <AppIcon name="format-list-checks" size={icon.xs} color={colors.textSecondary} />
              <Text style={styles.stepChipText}>{subtasks.done}/{subtasks.total}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} />
    </View>
  );
});

// A tiny live-recording indicator shown inside the capture field while voice is on.
function PulseDot({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) { s.value = 1; return; }
    s.value = withRepeat(withSequence(
      withTiming(1.6, { duration: 620, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
    ), -1, true);
  }, [reduceMotion, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2 - s.value }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }, style]} />;
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    // The mascot is pinned to the hero's bottom, so a short hero (small text size, one-line
    // purpose) lifted it onto the search/inbox/bell row. 188 = top pad 24 + icons 44 + gap 8 +
    // mascot 96 + bottom 16 — it stays below the icons at every text size (rc.19 phone check).
    hero: { position: 'relative', overflow: 'hidden', minHeight: 188, marginTop: spacing.xs, marginBottom: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg, borderRadius: radius.xxl, ...elevation.raised, shadowColor: colors.primary, shadowOpacity: 0.18 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    headerCopy: { flexShrink: 1, flex: 1, minWidth: 0 },
    // The one card a first-time user reads. Same tokens as every other surface here —
    // it should look like part of the app, not like an advertisement inside it.
    welcome: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: border.thin, borderColor: colors.border, gap: spacing.sm, marginBottom: spacing.md,
    },
    welcomeTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '800' },
    welcomeBody: { color: colors.textSecondary, ...typography.meta, lineHeight: 21 },
    welcomeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    welcomePrimary: {
      flex: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primary,
    },
    welcomePrimaryText: { color: colors.onPrimary, ...typography.meta, fontWeight: '800' },
    welcomeSecondary: {
      flexShrink: 1, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: spacing.md, borderRadius: radius.md,
      borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
    },
    welcomeSecondaryText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.sm, marginBottom: spacing.md },
    moduleTile: { flexBasis: '31.5%', flexGrow: 1, minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
    moduleIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    moduleLabel: { color: colors.textPrimary, ...typography.caption, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 15 },
    insightCard: { borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
    insightTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    insightTitle: { flex: 1, minWidth: 0, ...typography.callout, fontWeight: '800' },
    insightDetail: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs, lineHeight: 19 },
    heroMarkSlot: { position: 'absolute', right: spacing.md, bottom: spacing.md, zIndex: 30 },
    greeting: { color: colors.onPrimary, ...typography.title },
    eyebrow: { color: colors.primary, ...typography.label, letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.display, marginTop: spacing.sm },
    date: { color: 'rgba(255,255,255,0.88)', ...typography.bodySmall, marginTop: spacing.xxs },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.sm },
    heroDot: { position: 'absolute', top: -4, right: -4, minWidth: 18, minHeight: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
    heroDotText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
    heroBell: { width: control.iconButtonSize - 4, height: control.iconButtonSize - 4, borderRadius: radius.md, borderWidth: border.thin, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
    heroBadge: { alignSelf: 'flex-start', marginTop: spacing.smd, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderColor: 'rgba(255,255,255,0.28)', borderWidth: border.thin, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: spacing.smd, paddingVertical: spacing.xs },
    heroBadgeText: { color: colors.onPrimary, ...typography.caption, fontWeight: '800' },
    heroPurpose: { color: 'rgba(255,255,255,0.92)', ...typography.caption, lineHeight: 18, marginTop: spacing.sm, maxWidth: '74%' },
    capture: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.raised },
    captureLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    // No letterSpacing: Android mis-measures spaced Bengali and clips the line. flexShrink
    // lets it give way rather than being cut off when the row is tight.
    // The whole row, not the width Android measured for it: that measurement comes up short
    // for this Bengali line, and a label hugging it lost its last word ("… বা" without "বলুন").
    captureLabel: { flex: 1, color: colors.textSecondary, ...typography.label, fontWeight: '700' },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    inputWrap: { flex: 1, minWidth: 0, position: 'relative' },
    input: { minWidth: 0, minHeight: control.inputHeight, maxHeight: 132, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.smd, ...typography.body, textAlignVertical: 'top' },
    voiceTag: { position: 'absolute', top: spacing.xs, right: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    voiceTagText: { color: colors.danger, ...typography.caption, fontWeight: '700' },
    micBtnActive: { backgroundColor: colors.danger, borderColor: colors.danger },
    voiceNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, paddingHorizontal: spacing.smd, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: border.thin, borderColor: accents.orange.border, backgroundColor: accents.orange.soft },
    voiceNoteText: { flex: 1, minWidth: 0, color: accents.orange.on, ...typography.caption, fontWeight: '700' },
    addButton: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.lg, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    micBtn: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    photoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    photoBtn: { flex: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    photoBtnText: { flexShrink: 1, color: colors.primary, ...typography.meta, fontWeight: '800' },
    photoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
    photoNoteText: { flex: 1, color: colors.textMuted, ...typography.caption },
    understand: { marginTop: spacing.md, borderWidth: border.thin, borderColor: accents.green.border, borderRadius: radius.lg, backgroundColor: accents.green.soft, padding: spacing.md },
    understandHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    understandTitle: { color: accents.green.on, ...typography.cardTitle, fontWeight: '700' },
    understandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    understandRowLabel: { color: accents.green.on, ...typography.caption, fontWeight: '700', minWidth: 56 },
    understandRowValue: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    understandActions: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
    confirmBtn: { minHeight: control.buttonHeight, alignSelf: 'stretch', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.smd },
    altBtn: { flex: 1, minHeight: control.buttonHeight, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
    altText: { ...typography.caption, fontFamily: typography.label.fontFamily },
    confirmText: { color: colors.onPrimary, ...typography.bodySmall, fontFamily: typography.label.fontFamily },
    memoryBtn: { minHeight: control.buttonHeight, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: accents.purple.base, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    ghostBtn: { minHeight: control.buttonHeight, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
    ghostText: { color: colors.primary, ...typography.bodySmall, fontFamily: typography.label.fontFamily },
    ghostTextMuted: { color: colors.textSecondary, ...typography.bodySmall, fontFamily: typography.label.fontFamily },
    iconGhost: { minHeight: control.buttonHeight, minWidth: layout.minTouchTarget, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    choiceCard: { marginTop: spacing.md, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, padding: spacing.md },
    choiceQ: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, marginBottom: spacing.sm },
    purpose: { color: colors.textSecondary, ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
    captureTools: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    toolBtn: { flex: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    toolText: { color: colors.primary, ...typography.caption, fontWeight: '800' },
    freqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
    freqChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, maxWidth: 220, minHeight: layout.minTouchTarget - spacing.smd, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
    freqText: { flexShrink: 1, color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    debtCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: control.rowMinHeight, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, borderRadius: radius.lg, borderWidth: border.thin, borderColor: accents.red.border, backgroundColor: accents.red.soft },
    debtIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    debtBody: { flex: 1, minWidth: 0 },
    debtLabel: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    debtValue: { color: accents.red.on, ...typography.cardTitle, fontFamily: typography.numeric.fontFamily },
    debtHint: { color: colors.textMuted, ...typography.caption },
    suggestCard: { marginTop: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm, ...elevation.soft },
    suggestIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    suggestText: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    suggestActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    suggestGo: { flex: 1, minHeight: control.buttonHeight, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: accents.blue.base, alignItems: 'center', justifyContent: 'center' },
    suggestGoText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '700', textAlign: 'center' },
    suggestX: { width: 44, height: control.buttonHeight, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    moreWrap: { marginTop: spacing.md, alignItems: 'center' },
    moreFade: { position: 'absolute', left: 0, right: 0, top: -spacing.xl, height: spacing.xl },
    moreToggle: { minHeight: control.buttonHeight, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, ...elevation.soft },
    moreToggleText: { color: colors.primary, ...typography.bodySmall, fontWeight: '700', textAlign: 'center' },
    understandHint: { color: accents.green.on, ...typography.caption, marginTop: spacing.sm, opacity: 0.9 },
    hintPreview: { marginTop: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    hintEyebrow: { color: colors.primary, ...typography.label, fontWeight: '800' },
    hintValue: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700', marginTop: spacing.xxs },
    error: { color: colors.danger, ...typography.bodySmall, marginTop: spacing.md },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm},
    sectionTitle: { color: colors.textPrimary, ...typography.heading, fontWeight: '700', flexShrink: 1, flexGrow: 1 },
    sectionHint: { color: colors.textMuted, ...typography.caption, marginTop: -spacing.xxs, marginBottom: spacing.sm },
    textAction: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingLeft: spacing.smd, paddingRight: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
    textActionText: { color: colors.primary, ...typography.bodySmall, fontWeight: '700' },
    focusGrid: { flexDirection: 'row', gap: spacing.sm },
    focusCard: { flex: 1, minHeight: control.rowMinHeight + spacing.lg, borderWidth: border.thin, borderRadius: radius.lg, padding: spacing.md },
    focusIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    focusValue: { ...typography.title, fontWeight: '700', marginTop: spacing.sm },
    focusLabel: { ...typography.caption, fontWeight: '700', marginTop: spacing.xxs },
    taskRow: { minHeight: control.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.sm, marginBottom: spacing.sm, ...elevation.card },
    checkbox: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxDone: { backgroundColor: colors.success, borderColor: colors.success },
    taskBody: { flex: 1, minWidth: 0, minHeight: control.iconButtonSize, justifyContent: 'center' },
    taskTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxs, flexWrap: 'wrap' },
    taskMeta: { color: colors.textMuted, ...typography.caption },
    stepChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
    stepChipText: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    memoryCard: { minHeight: control.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.sm, marginBottom: spacing.sm, ...elevation.card },
    memoryIcon: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    memoryTitle: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    psychCard: { marginTop: spacing.md, marginBottom: spacing.md, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm, ...elevation.soft },
    psychTitle: { flexShrink: 1, color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily },
    psychRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    psychText: { color: colors.textSecondary, ...typography.caption, lineHeight: 18 },
    progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
    progressRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    streakChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.accent, backgroundColor: accents.yellow.soft },
    streakText: { color: colors.accent, ...typography.caption, fontFamily: typography.numeric.fontFamily, fontWeight: '700' },
    progressCount: { color: colors.textPrimary, ...typography.cardTitle, fontFamily: typography.numeric.fontFamily },
    progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
    quickAction: { flex: 1, minHeight: control.rowMinHeight, borderWidth: border.thin, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.smd, paddingHorizontal: spacing.xs },
    quickLabel: { ...typography.caption, fontWeight: '800' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
