import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// What the records say about the month, for the screen to open with rather than a
// blank prompt. See `life-advice-service` for why it says so little so rarely.
import { monthlyAdvice, type Advice } from '../src/services/life-advice-service';
import { bangladeshDateKey, bnDayPart, formatBangladeshDate, formatBangladeshTime } from '../src/i18n/date-time';
import { clarifyQuestion } from '../src/ai/assistant/clarify';
import { asciiDigitsToBengali } from '../src/services/debt/money';
import { Switch, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { ModuleGuide } from '../src/ui/ModuleGuide';
import { LlmIssueCard } from '../src/ui/LlmIssueCard';
import { SpellingCheck } from '../src/ui/SpellingCheck';
import { useOcrLinePicker } from '../src/ui/OcrLinePicker';
import { suggestSpelling } from '../src/ai/nlp/spelling';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tagLabel } from '../src/ui/TagSuggestions';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSpeech } from '../src/hooks/useSpeech';
import { orchestrate, type OrchestratedAction, type OrchestratorResult } from '../src/ai/orchestrator';
import { updateContext, type OrchestrationContext } from '../src/ai/context';
import { recordAssistantTurn } from '../src/ai/assistant';
import { planTurn, describeAction, type TurnPlan } from '../src/ai/planner';
import { runPlan, type PlanRun } from '../src/services/agent-runner';
import { lastExpenseCategory } from '../src/services/finance-service';
import { lastOpenTaskTitle } from '../src/services/task-repository';
import { measure, recordTiming } from '../src/services/assistant-perf';
import { executeAssistantAction, resolveAssistantTaskChoice, resolveAssistantWallet, type AssistantExecutionResult } from '../src/services/assistant-action-service';
import { pendingNeedsSource } from '../src/services/ai-action-executor';
import type { FundSource } from '../src/services/finance-service';
import { FundSourcePicker, WalletPicker, moneyDetailsProblem } from '../src/ui/MoneyPickers';
import { useTaskStore } from '../src/store/task.store';
import { useMemoryStore } from '../src/store/memory.store';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppIcon } from '../src/ui/AppIcon';
import { AppState } from '../src/ui/AppSurface';
import { downloadVoicePack, openVoiceSettings, voiceOfflineStatus, type VoicePackState } from '../src/services/voice-offline-service';
import { canReadImages, captureAndReadText, describeReader } from '../src/services/ocr-service';
import { lastLoadDidNotFinish, releaseLlama } from '../src/ai/model/llama-runtime';
import { loadInstalledModel } from '../src/ai/model/model-manager';
import { getPreferredEngineId, setPreferredEngineId } from '../src/ai/engine/registry';
import { onDeviceLlmEngine } from '../src/ai/engine/on-device-llm-engine';
import { understandWithLlm } from '../src/ai/engine/understand';
import { routeTurn } from '../src/ai/router';
import { ABILITY_GROUPS, SCREENS, screenMentioned } from '../src/ai/capabilities';
import { followUps } from '../src/ai/assistant/follow-ups';
import { AttachmentPermissionError } from '../src/services/attachment-service';
import { localizeMemoryKind, localizeTaskPriority, localizeTaskStatus } from '../src/i18n/domain-labels';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, memoryKindIcon, type ThemeAccents, type ThemeColors } from '../src/theme';
import { AponMark } from '../src/ui/AponMark';

/** Bengali numerals in Bengali. ASCII digits inside a Bengali line make Android
 *  mis-measure the text and clip it, which is why this exists. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

type ActionType = OrchestratedAction['type'];
type WaitingMoney = Extract<AssistantExecutionResult, { type: 'NEEDS_WALLET' }>;

type Turn =
  | { id: string; input: string; type: 'exec'; result: AssistantExecutionResult }
  | { id: string; input: string; type: 'plan'; plan: TurnPlan; run: PlanRun }
  | { id: string; input: string; type: 'error' };

const MAX_TURNS = 8;
let turnSeq = 0;
const newTurnId = () => `t${++turnSeq}-${Date.now()}`;

function actionSummary(type: ActionType, bn: boolean): { title: string; icon: 'clipboard-plus-outline' | 'check-circle-outline' | 'format-list-checks' | 'calendar-clock-outline' | 'bookmark-plus-outline' | 'magnify' | 'help-circle-outline' | 'lifebuoy' | 'chat-outline' } {
  switch (type) {
    case 'SHOW_HELP': return { title: bn ? 'আমি কী কী করতে পারি' : 'What I can do', icon: 'lifebuoy' };
    case 'SMALL_TALK': return { title: bn ? 'একটু কথা' : 'A quick chat', icon: 'chat-outline' };
    case 'CREATE_TASK': return { title: bn ? 'একটি নতুন কাজ তৈরি করব' : 'Create a new task', icon: 'clipboard-plus-outline' };
    case 'COMPLETE_TASK': return { title: bn ? 'একটি কাজ সম্পন্ন হিসেবে চিহ্নিত করব' : 'Mark a task as done', icon: 'check-circle-outline' };
    case 'LIST_TASKS': return { title: bn ? 'আপনার কাজগুলো দেখাব' : 'Show your tasks', icon: 'format-list-checks' };
    case 'RESCHEDULE_TASK': return { title: bn ? 'একটি কাজের সময় পরিবর্তন করব' : 'Reschedule a task', icon: 'calendar-clock-outline' };
    case 'CREATE_MEMORY': return { title: bn ? 'একটি নতুন মেমোরি সংরক্ষণ করব' : 'Save a new memory', icon: 'bookmark-plus-outline' };
    case 'CREATE_DEBT': return { title: bn ? 'ধার/পাওনার হিসাব যোগ করব' : 'Record a debt or receivable', icon: 'clipboard-plus-outline' };
    case 'SEARCH_MEMORY': return { title: bn ? 'আপনার মেমোরিতে খুঁজব' : 'Search your memories', icon: 'magnify' };
    case 'ANSWER_QUESTION': return { title: bn ? 'সংরক্ষিত তথ্য থেকে উত্তর দেব' : 'Answer from your saved info', icon: 'magnify' };
    default: return { title: bn ? 'আরও তথ্য দরকার' : 'I need a little more detail', icon: 'help-circle-outline' };
  }
}

export default function AssistantScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const params = useLocalSearchParams<{ voice?: string; q?: string }>();
  // No tab bar here any more (আপন floats on the main pages), so the phone's own bar is kept clear.
  const insets = useSafeAreaInsets();
  const ocr = useOcrLinePicker();
  // An example tapped in a module guide arrives written in; the person still sends it.
  const [input, setInput] = useState(() => (typeof params.q === 'string' ? params.q.trim() : ''));
  const [busy, setBusy] = useState(false);
  // Reading a picture is the same act as typing or speaking — the words land in the same
  // box and go through the same understanding. Camera and gallery are asked for separately
  // because they need different permissions and mean different things.
  const [photoChoice, setPhotoChoice] = useState(false);
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // "AI দিয়ে বুঝুন": the model restates a sentence the core could not read (understand.ts);
  // the restatement lands in the box and still needs the person's send / confirm.
  const [understanding, setUnderstanding] = useState(false);
  const [dosePreview, setDosePreview] = useState<string | null>(null);
  // What the person has sent with ➤. Typing (or tapping an example) only fills the box;
  // the "here is what I understood" card appears for the text that was sent, never before.
  const [submitted, setSubmitted] = useState('');
  // Counts every send — the same words sent again are a new question too, so the last one's
  // AI notice is cleared (LlmIssueCard's resetKey).
  const [sendSeq, setSendSeq] = useState(0);
  const send = (text: string) => { setSubmitted(text); setSendSeq((n) => n + 1); };
  // The box as it is now, for work that finishes later (the AI reading a sentence).
  const inputNow = useRef(input);
  useEffect(() => { inputNow.current = input; }, [input]);
  const [understandNote, setUnderstandNote] = useState<string | null>(null);
  const ocrAvailable = useMemo(() => canReadImages(), []);
  // Whether this phone can already turn speech into text with the connection off.
  const [packState, setPackState] = useState<VoicePackState>('UNKNOWN');
  const [packBusy, setPackBusy] = useState(false);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [packFailed, setPackFailed] = useState(false);
  const checkPack = useCallback(async () => {
    // Asking Android about the pack is asynchronous by nature; there is no render-time
    // value to derive this from, so the answer has to land in state when it arrives.
    let next: VoicePackState = 'UNKNOWN';
    try { next = (await voiceOfflineStatus(bn ? 'bn' : 'en')).state; } catch { next = 'UNKNOWN'; }
    setPackState(next);
  }, [bn]);
  // The check is a one-shot query to Android on mount, not a render-derived value.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void checkPack(); }, [checkPack]);
  // A chat turn on this screen loads the whole GGUF model into native memory and — by
  // design — keeps it warm for a fast follow-up reply (see llama-runtime.ts). Nothing
  // released it when the person left this screen, so it stayed resident for the rest of
  // the app session: confirmed, live on device, as the reason Home/Planning/Memory started
  // failing to read the database minutes later even with the screen closed and no crash.
  // Releasing it here on unmount bounds the cost to "while this screen is open".
  // On blur, not on unmount: this screen's own back button and every result link
  // `router.push` another route on top of it, which leaves it mounted underneath — so an
  // unmount effect almost never ran, and the model stayed in RAM for the whole session.
  useFocusEffect(useCallback(() => () => { void releaseLlama(); }, []));

  // Which engine is really answering — re-read on every visit, since it is changed on the
  // AI model screen. Without this nobody could tell whether the AI was doing anything.
  const [aiStatus, setAiStatus] = useState<{ on: boolean; reason?: 'no-model' | 'crashed' | 'not-verified' | 'off' } | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    void (async () => {
      const pref = await getPreferredEngineId(db).catch(() => null);
      const model = await loadInstalledModel(db).catch(() => null);
      const on = pref === 'on-device-llm' && await onDeviceLlmEngine.isReady().catch(() => false);
      const reason = on ? undefined
        : !model ? 'no-model'
          : lastLoadDidNotFinish() ? 'crashed'
            : !model.verifiedAt || !model.connectionTest?.ok ? 'not-verified'
              : 'off';
      if (alive) setAiStatus({ on, reason });
    })();
    return () => { alive = false; };
  }, [db]));
  const getPack = useCallback(async () => {
    if (packBusy) return;
    setPackBusy(true);
    setPackNote(null);
    setPackFailed(false);
    try {
      const r = await downloadVoicePack(bn ? 'bn' : 'en');
      // Android answers three different ways and all three are true, so none is dressed
      // up as a finished download.
      setPackFailed(!r.ok);
      setPackNote(r.ok
        ? r.status === 'download_success'
          ? (bn ? '✓ ভাষার প্যাকেট নেমে গেছে — এখন ইন্টারনেট ছাড়াই বলে লেখা যাবে।' : '✓ Pack downloaded — speaking now works with no connection.')
          : r.status === 'download_scheduled'
            ? (bn ? 'ডাউনলোড সারিতে আছে — ওয়াই-ফাই পেলে নিজে থেকেই নেমে যাবে।' : 'Waiting — it will download by itself once you are on Wi-Fi.')
            : (bn ? 'ফোনের ডাউনলোড বাক্স খোলা হয়েছে — সেখান থেকে নামিয়ে নিন।' : 'The phone’s download dialog is open — fetch it from there.')
        : (bn ? 'নামানো গেল না। নিচে চাপুন — ফোনের ভয়েস সেটিংস খুলবে।' : 'Could not fetch it. Tap below to open the phone’s voice settings.'));
    } finally {
      setPackBusy(false);
      void checkPack();
    }
  }, [bn, packBusy, checkPack]);
  const [error, setError] = useState<string | null>(null);
  // A running transcript of finished exchanges (oldest → newest). The in-progress turn
  // is still previewed live below it.
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingChoice, setPendingChoice] = useState<{ input: string; result: Extract<AssistantExecutionResult, { type: 'NEEDS_TASK_CHOICE' }> } | null>(null);
  const [pendingWallet, setPendingWallet] = useState<{ input: string; result: Extract<AssistantExecutionResult, { type: 'NEEDS_WALLET' }> } | null>(null);
  // What the person picks on that card: the wallet, and — for money going out — whose money.
  const [cardWallet, setCardWallet] = useState<string | null>(null);
  const [cardSource, setCardSource] = useState<FundSource | null>(null);
  const [cardLoan, setCardLoan] = useState<string | null>(null);
  const [cardNote, setCardNote] = useState('');
  // A plan's money steps still waiting for their card, after the one on screen.
  const walletQueue = useRef<{ text: string; result: Pick<WaitingMoney, 'wallets' | 'pending'> }[]>([]);
  const askWallet = (asked: string, waiting: Pick<WaitingMoney, 'wallets' | 'pending'>) => {
    // Nothing was written yet — the entry waits for its wallet (T05) and, for money going
    // out, its source. Neither is ever shown chosen, not even a lone wallet.
    setPendingWallet({ input: asked, result: { type: 'NEEDS_WALLET', message: 'Which wallet did the money move through?', wallets: waiting.wallets, pending: waiting.pending } });
    setCardWallet(null);
    setCardSource(null);
    setCardLoan(null);
    setCardNote('');
  };
  const scroller = useRef<ScrollView>(null);
  const pushTurn = (turn: Turn) => setTurns(prev => [...prev, turn].slice(-MAX_TURNS));
  const loadTasks = useTaskStore(s => s.load);
  const loadMemories = useMemoryStore(s => s.load);
  const {
    supported: voiceSupported,
    listening: voiceListening,
    partial: voicePartial,
    lastError: voiceError,
    startListening,
    stopListening,
    speak,
  } = useSpeech(language);
  const voiceStarted = useRef(false);
  const spokenMode = useRef(false);
  // The trimmed input we last auto-ran, so a retrieval intent fires once per phrasing.
  const autoRanFor = useRef('');
  // The last sentence the AI was asked to read, and the text it produced — so neither is
  // sent to the model a second time.
  const understoodFor = useRef('');
  // Only a tapped suggestion is a finished sentence. Typing and dictation are not: running
  // on a 420 ms pause answered half-written questions — mid-word, and mid-sentence while
  // someone was still speaking. Those now wait for the send button.
  const explicitPick = useRef(false);
  const [voiceBase, setVoiceBase] = useState('');
  // Same inline flow as the Home capture field: the mic drops recognised words straight
  // into the input, live, and the whole transcript stays editable before you run it.
  /**
   * Photograph or choose a picture, and put whatever it says into the box.
   *
   * The text is not sent on its own. It lands in the input exactly as if it had been typed,
   * so the user reads it first — OCR gets things wrong, and silently acting on a misread
   * dose is a far worse failure than making someone glance at a line before sending it.
   */
  const readPhoto = async (source: 'camera' | 'gallery') => {
    setPhotoChoice(false);
    if (reading) return;
    setReading(true);
    setError(null);
    try {
      const result = await captureAndReadText(db, source, bn, true);
      if (result.cancelled) return;
      if (!result.ok || !result.text) {
        setError(result.reason ?? (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'));
        return;
      }
      spokenMode.current = false;
      // Same picker as Home: the photo and its lines, keep what is wanted (rc.13 QA G03).
      ocr.offer(result.text, result.note ?? null, result.imageUri, (picked) => setInput((base) => (base.trim() ? `${base.trim()}
${picked}` : picked)));
      setPhotoNote((bn
        ? `${describeReader(result.reader!, true)} দিয়ে পড়া হয়েছে — পাঠিয়ে দেওয়ার আগে দেখে নিন।`
        : `Read with ${describeReader(result.reader!, false)} — check it before sending.`) + (result.note ? ` ${result.note}` : ''));
    } catch (e) {
      setError(e instanceof AttachmentPermissionError
        ? (source === 'camera'
          ? (bn ? 'ক্যামেরার অনুমতি দেওয়া নেই।' : 'Camera permission is not granted.')
          : (bn ? 'ছবি দেখার অনুমতি দেওয়া নেই।' : 'Photo permission is not granted.'))
        : (bn ? 'ছবি থেকে লেখা তোলা গেল না।' : 'Could not read the image.'));
    } finally {
      setReading(false);
    }
  };

  const startVoice = () => {
    const base = input.trim();
    setVoiceBase(base);
    spokenMode.current = true;
    explicitPick.current = false;
    setError(null);
    void startListening((finalText) => {
      // Like keyboard dictation (the user's explicit choice, 2026-09-18): speech lands in the
      // box and waits for the send button — never sends itself. Tapping the mic again adds
      // to what is already there.
      setInput((base ? base + ' ' : '') + finalText);
      setError(null);
    });
  };
  const voiceValue = voiceListening ? (voiceBase ? voiceBase + ' ' : '') + voicePartial : input;
  useEffect(() => {
    if (params.voice === '1' && voiceSupported && !voiceStarted.current) {
      voiceStarted.current = true;
      startVoice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.voice, voiceSupported]);
  const [convoContext, setConvoContext] = useState<OrchestrationContext>({});
  // Read once when the screen opens. An assistant whose first screen is an empty box is
  // one that puts the whole burden of knowing what to ask on the person who came for help.
  const [advice, setAdvice] = useState<Advice[]>([]);

  // "আগেরবারের মতো ৫০০ টাকা" on a fresh open still means the last category actually spent
  // on — read once from the saved entries, never overriding what this conversation set.
  useEffect(() => {
    let alive = true;
    void lastExpenseCategory(db)
      .then((category) => { if (alive && category) setConvoContext(prev => prev.lastExpenseCategory ? prev : { ...prev, lastExpenseCategory: category }); })
      .catch(() => undefined);
    // Likewise "সেটা শেষ হয়েছে" after the app was closed and opened again.
    void lastOpenTaskTitle(db)
      .then((title) => { if (alive && title) setConvoContext(prev => prev.lastTaskText ? prev : { ...prev, lastTaskText: title }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [db]);

  useEffect(() => {
    let alive = true;
    void monthlyAdvice(db, language)
      .then((found) => { if (alive) setAdvice(found); })
      .catch(() => { if (alive) setAdvice([]); });
    return () => { alive = false; };
  }, [db, language]);
  // "সকাব ৯টায়" → asked "সকাল?" before anything runs (spelling.ts). "No" is remembered for this text.
  const [spellKept, setSpellKept] = useState('');
  const spelling = useMemo(() => suggestSpelling(input.trim()), [input]);
  const askSpelling = spelling && spellKept !== input.trim() ? spelling : null;
  // Nothing is read while typing — only once ➤ is pressed (the user's rule, rc.16 review:
  // half a sentence made the buttons and cards jump). Until then there is one ➤ button.
  const parseText = submitted === input.trim() ? input.trim() : '';
  const result = useMemo<OrchestratorResult | null>(() => (parseText ? measure('plan', () => orchestrate(parseText, new Date(), convoContext)) : null), [parseText, convoContext]);
  const plan = useMemo<TurnPlan | null>(() => { const value = input.trim(); return value ? planTurn(value, new Date(), convoContext) : null; }, [input, convoContext]);
  const isPlan = plan?.multi ?? false;
  const tryAiUnderstanding = async () => {
    if (understanding) return;
    const asked = input.trim();
    setUnderstanding(true);
    setUnderstandNote(null);
    const preferredEngineId = await getPreferredEngineId(db).catch(() => null);
    const out = await understandWithLlm(asked, { language: bn ? 'bn' : 'en', preferredEngineId, context: convoContext });
    setUnderstanding(false);
    // The box changed while the AI was reading (an example tapped, a photo, the mic): the
    // newer words win — the old sentence's reading never replaces them.
    if (inputNow.current.trim() !== asked) return;
    if (out.ok) {
      explicitPick.current = false; // still the person's send / confirm, never automatic
      understoodFor.current = out.text;
      setInput(out.text);
      setUnderstandNote(out.commands.length > 1
        ? (bn ? `AI এটাকে ${bnNum(out.commands.length)}টি কাজ হিসেবে বুঝেছে — নিচে দেখে ঠিক থাকলে নিশ্চিত করুন।` : `The AI read this as ${out.commands.length} things to do — check below and confirm if right.`)
        : (bn ? `AI এভাবে বুঝেছে: “${out.text}” — ঠিক থাকলে পাঠান বা নিশ্চিত করুন।` : `The AI read it as: “${out.text}” — send or confirm if that is right.`));
    } else {
      setUnderstandNote(out.reason === 'timeout'
        ? (bn ? 'AI সময়মতো বুঝতে পারেনি। একটু অন্যভাবে লিখে দেখুন।' : 'The AI took too long. Try saying it differently.')
        : (bn ? 'AI-ও নিশ্চিত হতে পারেনি — একটু অন্যভাবে লিখে দেখুন।' : 'The AI could not tell either — try saying it differently.'));
    }
  };

  // Read-only intents never mutate anything, so there is nothing to "confirm" — run them
  // straight away and show the reply, the way a real assistant would. Only the four
  // mutating intents (create / complete / reschedule task, save memory) keep the
  // explicit "Confirm and run" tap.
  const AUTO_RUN_TYPES: ReadonlySet<ActionType> = useMemo(
    () => new Set<ActionType>(['SHOW_HELP', 'SMALL_TALK', 'ANSWER_QUESTION', 'SEARCH_MEMORY', 'LIST_TASKS', 'ANALYZE_SPENDING', 'APP_QUERY', 'OPEN_SCREEN']),
    [],
  );
  const route = result ? routeTurn(result, Boolean(aiStatus?.on)) : null;
  // A sentence only the AI can read: ➤ starts the AI straight away (there is no second button).
  const aiTriedFor = useRef('');
  useEffect(() => {
    const key = input.trim();
    if (route !== 'llm-understand' || !key || submitted !== key || understanding || aiTriedFor.current === key) return;
    aiTriedFor.current = key;
    void Promise.resolve().then(() => tryAiUnderstanding());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, submitted, input]);
  // "ওষুধ খেয়েছি": say which dose before the confirm tap, not after it.
  const doseSubject = result?.action.type === 'APP_COMMAND' && result.action.topic === 'DOSE_TAKEN' ? (result.action.subject ?? '') : null;
  useEffect(() => {
    if (doseSubject === null) return;
    let alive = true;
    void import('../src/services/app-query-service')
      .then(({ previewDose }) => previewDose(db, doseSubject || undefined, bn ? 'bn' : 'en'))
      .then((text) => { if (alive) setDosePreview(text); })
      .catch(() => { if (alive) setDosePreview(null); });
    return () => { alive = false; };
  }, [db, doseSubject, bn]);
  // A MEDIUM-confidence reading shows its preview and waits for send, even when read-only.
  const isAutoRun = result ? AUTO_RUN_TYPES.has(result.action.type) : false;
  const isConversational = isAutoRun;
  const ready = result?.status === 'READY' && result.action.type !== 'CLARIFY';
  // Keep the newest content in view: after a turn lands, when a task-choice appears, and
  // when a confirmable "here's what I understood" preview first shows mid-conversation.
  useEffect(() => {
    if (turns.length === 0 && !pendingChoice && !ready) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [turns.length, pendingChoice, ready]);

  const runWholePlan = async () => {
    if (!plan || !plan.multi || busy) return;
    // Like execute(): a word that looks mistyped is asked about before any step runs.
    if (askSpelling) return;
    const startedAt = Date.now();
    const fromVoice = spokenMode.current;
    const asked = input.trim();
    setBusy(true); setError(null);
    try {
      const run = await runPlan(db, plan, { language, enhance: true });
      pushTurn({ id: newTurnId(), input: asked, type: 'plan', plan, run });
      setInput('');
      // A money step wrote nothing yet: the same wallet/source card as a single money
      // sentence, one step after another.
      const [first, ...rest] = run.waiting;
      if (first) { walletQueue.current = [...walletQueue.current, ...rest]; askWallet(first.text, first.result); }
      setConvoContext(prev => plan.steps.reduce((c, s) => s.status === 'READY' ? updateContext(s.nlp.intent, s.nlp.entities, c) : c, prev));
      await Promise.all([loadTasks(db), loadMemories(db)]);
      if (fromVoice) {
        const done = run.outcomes.filter(o => o.state === 'DONE').length;
        speak(bn ? `${bnNum(done)}টি ধাপ সম্পন্ন হয়েছে।` : `${bnNum(done)} step(s) completed.`);
      }
    } catch (e) {
      setError(bn ? 'পরিকল্পনা চালানো যায়নি' : 'Could not run the plan');
      recordAssistantTurn({
        at: new Date().toISOString(), input: asked, source: fromVoice ? 'voice' : 'text',
        intent: 'PLAN', confidence: 0, status: 'FAILED', actionType: 'RUN_PLAN',
        outcome: 'ERROR', durationMs: Date.now() - startedAt,
        detail: [e instanceof Error ? e.message : String(e)],
      });
    } finally { setBusy(false); }
  };

  const execute = async () => {
    if (!result || result.status !== 'READY' || result.action.type === 'CLARIFY' || busy) return;
    // A word that looks mistyped is asked about first; nothing runs until it is answered.
    if (askSpelling) return;
    // A question sent by its own ➤ or a tapped example is a new send too.
    if (AUTO_RUN_TYPES.has(result.action.type)) setSendSeq((n) => n + 1);
    const action = result.action;
    const startedAt = Date.now();
    const fromVoice = spokenMode.current;
    const asked = input.trim();
    setBusy(true); setError(null);
    try {
      const next = await executeAssistantAction(db, action, { language, enhance: true, previousMoney: convoContext.lastMoney });
      recordTiming('execute', Date.now() - startedAt);
      if (fromVoice) { const msg = executionMessage(next, bn); if (msg) speak(msg); }
      if (next.type === 'NEEDS_TASK_CHOICE') {
        setPendingChoice({ input: asked, result: next });
      } else if (next.type === 'NEEDS_WALLET') {
        askWallet(asked, next);
      } else {
        pushTurn({ id: newTurnId(), input: asked, type: 'exec', result: next });
        setInput('');
        // "সেটিংস খোলো" — the person asked to go there, so go; the reply stays in the chat.
        if (next.type === 'APP_REPLY' && next.navigate && next.open) router.push(SCREENS[next.open].route as never);
      }
      setConvoContext(prev => ({
        ...updateContext(result.nlp.intent, result.nlp.entities, prev),
        // Remember what the last money question was about, so "আর গত মাসে?" keeps the
        // subject instead of starting again from nothing. Only replaced when this turn
        // actually was one — an unrelated task in between should not wipe the thread.
        lastMoney: next.type === 'ANSWER' && next.askedMoney ? next.askedMoney : prev.lastMoney,
      }));
      await Promise.all([loadTasks(db), loadMemories(db)]);
      recordAssistantTurn({
        at: new Date().toISOString(), input: asked, source: fromVoice ? 'voice' : 'text',
        intent: result.nlp.intent, confidence: result.nlp.confidence, status: result.status,
        actionType: action.type, outcome: next.type, durationMs: Date.now() - startedAt,
        detail: next.type === 'ANSWER' ? next.answer.trace : undefined,
      });
    } catch (e) {
      setError(bn ? 'কাজটি করা যায়নি — আবার চেষ্টা করুন' : 'Unable to run the local action');
      recordAssistantTurn({
        at: new Date().toISOString(), input: asked, source: fromVoice ? 'voice' : 'text',
        intent: result.nlp.intent, confidence: result.nlp.confidence, status: result.status,
        actionType: action.type, outcome: 'ERROR', durationMs: Date.now() - startedAt,
        detail: [e instanceof Error ? e.message : String(e)],
      });
    }
    finally { setBusy(false); }
  };

  // Read-only intents shouldn't need a "Confirm and run" tap — run them straight away so
  // the assistant feels like a chat, not a form.
  useEffect(() => {
    const type = result?.action.type;
    const key = input.trim();
    if (!key) { autoRanFor.current = ''; return; }
    // A multi-step sentence waits on its plan card: running its read-only half here cleared
    // the box and lost the plan.
    if (!type || busy || !ready || route !== 'deterministic' || !AUTO_RUN_TYPES.has(type) || autoRanFor.current === key || !explicitPick.current || isPlan) return;
    // Waits for the spelling question; runs once it is answered either way.
    if (askSpelling) return;
    // Help / small talk are pure and instant; the retrieval intents touch the local
    // database, so let the input settle for a beat before firing.
    const instant = type === 'SHOW_HELP' || type === 'SMALL_TALK';
    const timer = setTimeout(() => {
      autoRanFor.current = key;
      explicitPick.current = false;
      void execute();
    }, instant ? 0 : 420);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, busy, ready, askSpelling, isPlan]);


  // Escape hatch for a genuinely unrecognised line: search the saved memories with the
  // raw text so the user is never left with only "I didn't catch that".
  const runFallbackSearch = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true); setError(null);
    try {
      const next = await executeAssistantAction(db, { type: 'SEARCH_MEMORY', query: q }, { language, enhance: true });
      pushTurn({ id: newTurnId(), input: q, type: 'exec', result: next });
      setInput('');
      await Promise.all([loadTasks(db), loadMemories(db)]);
    } catch {
      setError(bn ? 'খোঁজা সম্পন্ন হয়নি' : 'Search did not complete');
    } finally {
      setBusy(false);
    }
  };

  const saveMoneyCard = async () => {
    if (busy || !pendingWallet) return;
    const { input: asked, result: waiting } = pendingWallet;
    const problem = moneyDetailsProblem({ walletId: cardWallet, needsSource: pendingNeedsSource(waiting.pending), fundSource: cardSource }, bn);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const next = await resolveAssistantWallet(db, waiting.pending, cardWallet!, { fundSource: cardSource, fundAccountId: cardLoan, fundNote: cardNote });
      if (spokenMode.current) { const msg = executionMessage(next, bn); if (msg) speak(msg); }
      pushTurn({ id: newTurnId(), input: asked, type: 'exec', result: next });
      const queued = walletQueue.current.shift();
      if (queued) askWallet(queued.text, queued.result); else setPendingWallet(null);
      setInput('');
    } catch { setError(bn ? 'হিসাবটি রাখা যায়নি — আবার চেষ্টা করুন' : 'Could not save the entry'); }
    finally { setBusy(false); }
  };

  const pickTaskChoice = async (taskId: string) => {
    if (busy || !pendingChoice) return;
    const { input: asked, result: choice } = pendingChoice;
    setBusy(true); setError(null);
    try {
      const next = await resolveAssistantTaskChoice(db, choice.pending, taskId);
      if (spokenMode.current) { const msg = executionMessage(next, bn); if (msg) speak(msg); }
      pushTurn({ id: newTurnId(), input: asked, type: 'exec', result: next });
      setPendingChoice(null);
      setInput('');
      await Promise.all([loadTasks(db), loadMemories(db)]);
    } catch { setError(bn ? 'কাজটি করা যায়নি — আবার চেষ্টা করুন' : 'Unable to run the local action'); }
    finally { setBusy(false); }
  };

  const copy = bn
    ? { back: 'ফিরে যান', eyebrow: 'আমি আপন', title: 'আপনাকে কীভাবে সাহায্য করতে পারি?', subtitle: 'যা দরকার সাধারণ কথায় লিখুন বা 🎤 চেপে বলুন — কাজ, টাকা, ওষুধ, মনে রাখার কথা, সব আমি বুঝে নেব।', placeholder: 'যেমন: আগামীকাল সকাল ৯টায় দোকানদারকে ফোন করতে হবে', understanding: 'আমি যা বুঝেছি', task: 'কাজ', memory: 'মেমোরি', query: 'খোঁজা', date: 'তারিখ', time: 'সময়', priority: 'অগ্রাধিকার', tags: 'ট্যাগ', clarify: 'এই কমান্ডটি সম্পন্ন করার আগে আরও একটু তথ্য দিন।', unsupported: 'ঠিক ধরতে পারলাম না — এটা আমি এখনো পারি না। নিচের যেকোনোটা বেছে নিন, বা একটু অন্যভাবে বলুন। “সাহায্য” লিখলে কী কী পারি সব দেখাব।', searchAnyway: 'তবুও আমার তথ্যে খুঁজুন', tryThese: 'এগুলো চেষ্টা করুন', helpChip: 'সাহায্য দেখাও', execute: 'নিশ্চিত করে চালান', empty: 'কী করতে চান লিখুন বা বলুন — আমি বুঝে নিয়ে দেখাব কী হবে।', completed: 'সম্পন্ন হয়েছে', planning: 'পরিকল্পনা খুলুন', memoryOpen: 'মেমোরি খুলুন', retry: 'আবার চেষ্টা করুন', command: 'আপনকে লিখুন', micStart: 'কথা বলে লিখুন', micStop: 'শোনা বন্ধ করুন', listening: 'শুনছি… বলুন', voiceOffline: 'বলা কথা লেখায় বদলাতে ফোনের ভয়েস সেবা লাগে — এই ধাপে ইন্টারনেট দরকার। লেখা ও বাকি সবকিছু অফলাইনেই হয়।' }
    : { back: 'Back', eyebrow: 'I AM APON', title: 'How can I help you?', subtitle: 'Ask me anything about the app, or just say what to do. All of it happens on this phone — nothing leaves it.', placeholder: 'e.g. আগামীকাল সকাল ৯টায় দোকানদারকে ফোন করতে হবে', understanding: 'Here’s what I understood', task: 'Task', memory: 'Memory', query: 'Search', date: 'Date', time: 'Time', priority: 'Priority', tags: 'Tags', clarify: 'Add a little more detail before this can run.', unsupported: 'I did not catch that — it is something I cannot do yet. Pick one below, or say it another way. Type “help” to see everything I can do.', searchAnyway: 'Search my info anyway', tryThese: 'Try one of these', helpChip: 'Show help', execute: 'Confirm and run', empty: 'Type a local command — I’ll interpret it and show what will happen.', completed: 'Done', planning: 'Open planning', memoryOpen: 'Open memory', retry: 'Retry', command: 'Local assistant command', micStart: 'Speak instead of typing', micStop: 'Stop listening', listening: 'Listening… go ahead', voiceOffline: 'Turning speech into text uses the phone’s voice service, so this step needs internet. Typing and everything else stay offline.' };

  const summary = result ? actionSummary(result.action.type, bn) : null;
  const time = result?.nlp.entities.time;

  const showEmpty = turns.length === 0 && !input.trim() && !pendingChoice;

  return (
    <ScrollView keyboardDismissMode="on-drag" ref={scroller} style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {ocr.picker}
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}  accessibilityRole="button" accessibilityLabel={copy.back} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}><AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{copy.back}</Text></Pressable>
        {aiStatus ? (
          <View style={styles.aiRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'AI-এর অবস্থা — AI মডেলের পাতা খুলুন' : 'AI status — open the AI model screen'}
            onPress={() => router.push('/ai-model' as never)}
            style={({ pressed }) => StyleSheet.flatten([styles.suggestChip, { flexShrink: 1 }, pressed && styles.pressed])}
          >
            <AppIcon name={aiStatus.on ? 'brain' : 'cog-outline'} size={icon.xs} color={aiStatus.on ? colors.success : colors.textMuted} />
            <Text numberOfLines={1} style={styles.suggestChipText}>{aiStatus.on
              ? (bn ? 'AI চালু' : 'AI on')
              : `${bn ? 'সাধারণ মোড' : 'Built-in mode'} · ${{
                'no-model': bn ? 'AI মডেল নেই' : 'no AI model',
                crashed: bn ? 'AI বন্ধ — গতবার সমস্যা' : 'AI off after a problem',
                'not-verified': bn ? 'AI যাচাই বাকি' : 'AI not verified',
                off: bn ? 'AI বন্ধ রাখা' : 'AI switched off',
              }[aiStatus.reason ?? 'off']}`}</Text>
          </Pressable>
          {/* A verified model can be switched on and off right here; anything short of that
              (no model, not tested, crashed last time) still goes to the AI model screen. */}
          {aiStatus.on || aiStatus.reason === 'off' ? (
            <Switch
              accessibilityLabel={bn ? 'আপন-এ AI চালু/বন্ধ' : 'AI in Apon on/off'}
              value={aiStatus.on}
              onValueChange={(v) => {
                setAiStatus({ on: v, reason: v ? undefined : 'off' });
                void setPreferredEngineId(db, v ? 'on-device-llm' : 'local-rules').catch(() => setAiStatus({ on: !v, reason: v ? 'off' : undefined }));
              }}
              trackColor={{ false: colors.border, true: colors.success }}
              thumbColor={colors.surface}
            />
          ) : null}
          </View>
        ) : null}
        <View style={styles.titleRow}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}><AponMark size={40} /></View>
          <View style={styles.titleCopy}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text></View>
          <ModuleGuide id="assistant" autoOpen={!params.q} />
        </View>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <LlmIssueCard hideTimeout resetKey={sendSeq} />
        {/* The yellow notice below already says this when the phone has no offline pack. */}
        {voiceSupported && packState !== 'MISSING' && packState !== 'UNSUPPORTED' ? (
          <View style={styles.voiceHint}><AppIcon name="microphone-outline" size={icon.xs} color={colors.textMuted} /><Text style={styles.voiceHintText}>{copy.voiceOffline}</Text></View>
        ) : null}
      </View>

      <View style={styles.inputBox}>
        <AppIcon name="message-processing-outline" size={icon.md} color={colors.textMuted} />
        <TextInput
          value={voiceValue}
          onChangeText={value => { spokenMode.current = false; explicitPick.current = false; setUnderstandNote(null); setInput(value); setError(null); if (pendingChoice) setPendingChoice(null); }}
          editable={!busy && !voiceListening && !understanding}
          placeholder={copy.placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          style={styles.input}
          accessibilityLabel={copy.command}
        />
        {/* Questions are sent by hand now (see `explicitPick`). Commands that write
            something keep their own confirm button on the preview card below. */}
        {/* A sentence only the AI can read starts it on ➤ — never while still typing. */}
        {route === 'llm-understand' && input.trim() && !understanding && !voiceListening ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'AI দিয়ে বুঝে নিন' : 'Let the AI read it'}
            onPress={() => { send(input.trim()); void tryAiUnderstanding(); }}
            style={({ pressed }) => StyleSheet.flatten([styles.micButton, styles.micButtonActive, pressed && styles.pressed])}
          >
            <AppIcon name="send" size={icon.md} color={colors.onPrimary} />
          </Pressable>
        ) : null}
        {/* Everything else: ➤ shows what was understood, and its own ✓ does the work. */}
        {!isAutoRun && route !== 'llm-understand' && input.trim() && submitted !== input.trim() && !busy && !voiceListening ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'পাঠান' : 'Send'}
            onPress={() => { explicitPick.current = true; send(input.trim()); }}
            style={({ pressed }) => StyleSheet.flatten([styles.micButton, styles.micButtonActive, pressed && styles.pressed])}
          >
            <AppIcon name="send" size={icon.md} color={colors.onPrimary} />
          </Pressable>
        ) : null}
        {isAutoRun && !isPlan && input.trim() && !busy && !voiceListening ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'পাঠান' : 'Send'}
            onPress={() => { autoRanFor.current = input.trim(); void execute(); }}
            style={({ pressed }) => StyleSheet.flatten([styles.micButton, styles.micButtonActive, pressed && styles.pressed])}
          >
            <AppIcon name="send" size={icon.md} color={colors.onPrimary} />
          </Pressable>
        ) : null}
        {ocrAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ছবি থেকে লেখা তুলুন' : 'Read text from a picture'}
            disabled={reading || busy}
            onPress={() => { setPhotoChoice((open) => !open); setPhotoNote(null); }}
            style={({ pressed }) => StyleSheet.flatten([styles.micButton, photoChoice && styles.micButtonActive, pressed && styles.pressed])}
          >
            {reading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <AppIcon name="camera-outline" size={icon.md} color={photoChoice ? colors.onPrimary : colors.primary} />}
          </Pressable>
        ) : null}
        {voiceSupported ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={voiceListening ? copy.micStop : copy.micStart}
            onPress={() => { if (voiceListening) stopListening(); else startVoice(); }}
            style={({ pressed }) => StyleSheet.flatten([styles.micButton, voiceListening && styles.micButtonActive, pressed && styles.pressed])}
          >
            <AppIcon name={voiceListening ? 'pause' : 'microphone'} size={icon.md} color={voiceListening ? colors.onPrimary : colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {voiceListening ? (
        <View style={styles.voiceTag} pointerEvents="none" accessibilityLiveRegion="polite">
          <View style={styles.voiceTagDot} />
          <Text style={styles.voiceTagText}>{voicePartial.trim() ? (bn ? 'শুনছি…' : 'Listening…') : (bn ? 'শুনছি… বলুন' : 'Listening… speak')}</Text>
        </View>
      ) : null}
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
      {understanding ? (
        <View style={styles.photoNote} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.photoNoteText}>{bn ? 'AI আপনার কথাটা বোঝার চেষ্টা করছে… (কয়েক সেকেন্ড লাগতে পারে)' : 'The AI is reading what you said… (may take a few seconds)'}</Text>
        </View>
      ) : understandNote ? (
        <View style={styles.photoNote}>
          <AppIcon name="brain" size={icon.xs} color={colors.textMuted} />
          <Text style={styles.photoNoteText}>{understandNote}</Text>
        </View>
      ) : null}
      {voiceSupported && !voiceListening && (voiceError === 'permission' || voiceError === 'unavailable' || voiceError === 'network') ? (
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
              ? (bn ? 'মাইক্রোফোনের অনুমতি বন্ধ — সেটিংসে চালু করুন' : 'Microphone permission is off — enable it in Settings')
              // The no-internet case: the fix is the download below, not a broken device.
              : voiceError === 'network'
                ? (bn ? 'অফলাইনে বলে লেখা এই মুহূর্তে যাচ্ছে না — বিস্তারিত ও সমাধান দেখতে চাপুন' : 'Speaking with no connection isn’t working right now — tap to see why and what to do')
                : (bn ? 'এই ফোনে ভয়েস চালু হয়নি — টাইপ করে লিখুন' : 'Voice isn’t available here — please type instead')}
          </Text>
        </Pressable>
      ) : null}

      {voiceSupported && packState === 'MISSING' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: packBusy, busy: packBusy }}
          accessibilityLabel={bn ? 'ভাষার প্যাকেট নামান' : 'Download the language pack'}
          disabled={packBusy}
          onPress={() => void getPack()}
          style={({ pressed }) => StyleSheet.flatten([styles.voiceNote, (pressed || packBusy) && styles.pressed])}
        >
          {packBusy
            ? <ActivityIndicator size="small" color={accents.orange.on} />
            : <AppIcon name="download-outline" size={icon.xs} color={accents.orange.on} />}
          <Text style={styles.voiceNoteText}>
            {bn
              ? 'একবার ইন্টারনেট দিয়ে ভাষার প্যাকেটটি নামিয়ে নিন — এরপর নেট ছাড়াই বলে লেখা যাবে।'
              : 'Fetch the language pack once over the internet — after that, speaking works with no connection.'}
          </Text>
        </Pressable>
      ) : null}
      {packNote ? (
        packFailed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ফোনের ভয়েস সেটিংস খুলুন' : 'Open the phone’s voice settings'}
            onPress={() => void openVoiceSettings()}
            style={({ pressed }) => StyleSheet.flatten([styles.voiceNote, pressed && styles.pressed])}
          >
            <AppIcon name="cog-outline" size={icon.xs} color={accents.orange.on} />
            <Text style={styles.voiceNoteText}>{packNote}</Text>
          </Pressable>
        ) : (
          <Text style={styles.voiceNoteText}>{packNote}</Text>
        )
      ) : null}
      {voiceSupported && packState === 'UNSUPPORTED' ? (
        <View style={styles.voiceNote}>
          <AppIcon name="information-outline" size={icon.xs} color={accents.orange.on} />
          <Text style={styles.voiceNoteText}>
            {bn
              ? 'এই ফোনের ভয়েস সেবা বাংলা অফলাইনে বোঝে না, তাই বলে লেখার সময় ইন্টারনেট লাগবে। লেখা ও বাকি সবকিছু অফলাইনেই চলে।'
              : 'This phone’s voice service cannot do this language offline, so speaking needs a connection. Typing and everything else stay offline.'}
          </Text>
        </View>
      ) : null}

      {turns.map(turn => (
        <View key={turn.id}>
          <View style={styles.userBubbleRow}><View style={styles.userBubble}><Text style={styles.userBubbleText}>{turn.input}</Text></View></View>
          {turn.type === 'plan' ? (
            <PlanCard plan={turn.plan} run={turn.run} busy={false} bn={bn} styles={styles} colors={colors} accents={accents} onRun={() => undefined} />
          ) : turn.type === 'error' ? (
            <View style={[styles.execution, { borderColor: accents.red.border, backgroundColor: accents.red.soft }]}>
              <View style={styles.cardHead}><AppIcon name="alert-circle-outline" size={icon.md} color={colors.danger} /><Text style={[styles.executionLabel, { color: colors.danger }]}>{bn ? 'সম্পন্ন হয়নি' : 'Did not complete'}</Text></View>
            </View>
          ) : (
            <ExecutionCard result={turn.result} asked={turn.input} styles={styles} copy={copy} colors={colors} bn={bn} onExample={(s) => { explicitPick.current = false; setInput(s); }} />
          )}
        </View>
      ))}

      {/* "সকাব ৯টায়" → "সকাল?" — once sent, asked before any answer or save, whatever the kind
          (it sat in the multi-step branch only, so a single task never showed it — rc.15 phone check). */}
      {askSpelling && input.trim() && submitted === input.trim() ? (
        <SpellingCheck suggestion={askSpelling} onAccept={(fixed) => { explicitPick.current = true; setInput(fixed); send(fixed); }} onKeep={() => setSpellKept(input.trim())} />
      ) : null}
      {isPlan && plan && input.trim() && submitted === input.trim() ? (
        <>
        <View style={styles.userBubbleRow}>
          <View style={styles.userBubble}><Text style={styles.userBubbleText}>{input.trim()}</Text></View>
        </View>
        <PlanCard plan={plan} run={null} busy={busy} bn={bn} styles={styles} colors={colors} accents={accents} onRun={() => void runWholePlan()} />
        </>
      ) : result && summary && !isConversational && submitted === input.trim() ? (
        <>
        <View style={styles.userBubbleRow}>
          <View style={styles.userBubble}><Text style={styles.userBubbleText}>{input.trim()}</Text></View>
        </View>
        <View style={[styles.card, result.status === 'UNSUPPORTED' && styles.cardMuted]}>
          <View style={styles.cardHead}>
            <View style={styles.cardHeadIcon}><AppIcon name={summary.icon} size={icon.md} color={accents.purple.on} /></View>
            <Text style={styles.cardEyebrow}>{copy.understanding}</Text>
          </View>
          {result.status === 'UNSUPPORTED' ? (
            <>
              <Text style={styles.plain}>{copy.unsupported}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.searchAnyway} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void runFallbackSearch()} style={({ pressed }) => StyleSheet.flatten([styles.executeButton, busy && styles.disabled, pressed && styles.pressed])}>
                {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="magnify" size={icon.sm} color={colors.onPrimary} /><Text style={styles.executeText}>{copy.searchAnyway}</Text></>}
              </Pressable>
              {/* Cannot do it here — but if the sentence names a part of the app, offer the way there. */}
              {screenMentioned(input) ? (
                <Pressable accessibilityRole="button" onPress={() => router.push(SCREENS[screenMentioned(input)!].route as never)} style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}>
                  <AppIcon name="arrow-top-right" size={icon.sm} color={colors.primary} />
                  <Text style={styles.linkText}>{bn ? `${SCREENS[screenMentioned(input)!].bn} খুলুন` : `Open ${SCREENS[screenMentioned(input)!].en}`}</Text>
                </Pressable>
              ) : null}
              {route === 'llm-understand' ? (
                <Pressable accessibilityRole="button" disabled={understanding} onPress={() => void tryAiUnderstanding()} style={({ pressed }) => StyleSheet.flatten([styles.executeButton, understanding && styles.disabled, pressed && styles.pressed])}>
                  {understanding ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="brain" size={icon.sm} color={colors.onPrimary} /><Text style={styles.executeText}>{bn ? 'AI দিয়ে বোঝার চেষ্টা করুন' : 'Let the AI try to understand'}</Text></>}
                </Pressable>
              ) : null}
              <Text style={styles.suggestLabel}>{copy.tryThese}</Text>
              <View style={styles.suggestRow}>
                {[
                  ...(bn
                    ? ['আগামীকাল সকাল ৯টায় মাকে ফোন করব', 'আমার wifi পাসওয়ার্ড মনে রাখো', 'আমার কাজগুলো দেখাও', 'আমার পাসপোর্টের মেয়াদ কত?', copy.helpChip]
                    : ['Call mom tomorrow at 9am', 'Remember my wifi password', 'Show my tasks', 'When does my passport expire?', copy.helpChip]),
                ].map(s => (
                  <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => { explicitPick.current = false; setInput(s === copy.helpChip ? (bn ? 'সাহায্য' : 'help') : s); setError(null); }} style={({ pressed }) => StyleSheet.flatten([styles.suggestChip, pressed && styles.pressed])}>
                    <AppIcon name={s === copy.helpChip ? 'lifebuoy' : 'lightbulb-outline'} size={icon.xs} color={colors.primary} />
                    <Text style={styles.suggestChipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.actionTitle}>{summary.title}</Text>
              {result.nlp.entities.taskText ? <Detail label={copy.task} value={result.nlp.entities.taskText} styles={styles} /> : null}
              {result.nlp.entities.memoryText ? <Detail label={copy.memory} value={result.nlp.entities.memoryText} styles={styles} /> : null}
              {result.nlp.entities.query ? <Detail label={copy.query} value={result.nlp.entities.query} styles={styles} /> : null}
              {result.nlp.entities.question ? <Detail label={bn ? 'প্রশ্ন' : 'Question'} value={result.nlp.entities.question} styles={styles} /> : null}
              {result.nlp.entities.keywords && result.nlp.entities.keywords.length ? <Detail label={bn ? 'খোঁজার শব্দ' : 'Keywords'} value={result.nlp.entities.keywords.join(', ')} styles={styles} /> : null}
              {result.nlp.entities.date ? <Detail label={copy.date} value={formatBangladeshDate(result.nlp.entities.date.isoDate, language)} styles={styles} /> : null}
              {time ? <Detail label={copy.time} value={clockText(time.minutes, bn)} styles={styles} /> : null}
              {result.nlp.entities.recurrence ? <Detail label={bn ? 'পুনরাবৃত্তি' : 'Repeats'} value={repeatWord(result.nlp.entities.recurrence, bn)} styles={styles} /> : null}
              {result.nlp.entities.priority && result.nlp.entities.priority !== 'MEDIUM' ? <Detail label={copy.priority} value={localizeTaskPriority(result.nlp.entities.priority, bn)} styles={styles} /> : null}
              {result.nlp.entities.tags && result.nlp.entities.tags.length ? <Detail label={copy.tags} value={result.nlp.entities.tags.map(t => `#${tagLabel(t, language === 'bn')}`).join(' ')} styles={styles} /> : null}
              {dosePreview && doseSubject !== null ? <Text style={styles.plain}>{dosePreview}</Text> : null}
              {ready ? (
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} onPress={() => void execute()} style={({ pressed }) => StyleSheet.flatten([styles.executeButton, busy && styles.disabled, pressed && styles.pressed])}>
                  {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="check" size={icon.sm} color={colors.onPrimary} /><Text style={styles.executeText}>{copy.execute}</Text></>}
                </Pressable>
              ) : (
                <>
                <View style={styles.clarifyBox}><AppIcon name="information-outline" size={icon.sm} color={accents.blue.on} /><Text style={styles.clarifyText}>{clarifyQuestion(result.action, bn) ?? copy.clarify}</Text></View>
                </>
              )}
            </>
          )}
        </View>
        </>
      ) : isAutoRun && busy && input.trim() && !error ? (
        <>
          <View style={styles.userBubbleRow}>
            <View style={styles.userBubble}><Text style={styles.userBubbleText}>{input.trim()}</Text></View>
          </View>
          <View style={styles.pendingRow}>
            <ActivityIndicator color={colors.primary} />
            <PendingStage type={result?.action.type} aiOn={Boolean(aiStatus?.on)} bn={bn} style={styles.pendingText} />
          </View>
        </>
      ) : showEmpty ? (
        <View style={styles.emptyState}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}><AponMark size={54} /></View>
          <Text style={styles.empty}>{copy.empty}</Text>

          {/* What this month actually did, before anyone asks. Each line is arithmetic
              over the records — never a judgement about how someone should live. */}
          {advice.length ? (
            <View style={styles.adviceBox}>
              <Text style={styles.suggestLabel}>{bn ? 'এ মাসের হিসাব' : 'This month so far'}</Text>
              {advice.map((a) => {
                const tone = a.tone === 'GOOD' ? accents.green : a.tone === 'WATCH' ? accents.orange : accents.blue;
                return (
                  <View key={a.id} style={[styles.adviceRow, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                    <AppIcon
                      name={a.tone === 'GOOD' ? 'check-circle-outline' : a.tone === 'WATCH' ? 'alert-outline' : 'information-outline'}
                      size={icon.sm}
                      color={tone.on}
                    />
                    <View style={styles.adviceBody}>
                      <Text style={styles.adviceText}>{a.text}</Text>
                      {a.detail ? <Text style={styles.adviceDetail}>{a.detail}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          {/* Everything it can do, grouped the way the app is — tap any line to try it. */}
          <Text style={styles.suggestLabel}>{bn ? 'আমি যা যা পারি — ছুঁয়ে দেখুন' : 'What I can do — tap to try'}</Text>
          <View style={styles.abilityGrid}>
            {ABILITY_GROUPS.map((g) => (
              <View key={g.id} style={styles.abilityCard}>
                <View style={styles.abilityHead}>
                  <AppIcon name={g.icon} size={icon.sm} color={colors.primary} />
                  <Text style={styles.abilityTitle}>{bn ? g.bn : g.en}</Text>
                </View>
                {(bn ? g.examples.bn : g.examples.en).map((s) => (
                  <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => {
                    // A tapped example is the person asking it: a question is answered at once, anything
                    // that saves still waits for their confirm. The answer is at the top, so go there.
                    explicitPick.current = true; setInput(s); setError(null);
                    scroller.current?.scrollTo({ y: 0, animated: true });
                  }} style={({ pressed }) => StyleSheet.flatten([styles.abilityExample, pressed && styles.pressed])}>
                    <Text style={styles.abilityExampleText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
          <Text style={[styles.suggestLabel, { textAlign: 'center' }]}>{bn ? 'অন্য যেকোনো প্রশ্নও করতে পারেন — না পারলে বলে দেব কোথায় পাবেন।' : 'Ask anything else too — if I cannot, I will say where to find it.'}</Text>
        </View>
      ) : null}

      {pendingChoice ? (
        <>
          <View style={styles.userBubbleRow}><View style={styles.userBubble}><Text style={styles.userBubbleText}>{pendingChoice.input}</Text></View></View>
          <View style={styles.execution}>
            <View style={styles.cardHead}><AppIcon name="help-circle-outline" size={icon.md} color={accents.blue.on} /><Text style={styles.executionLabel}>{bn ? 'কোন কাজ?' : 'Which task?'}</Text></View>
            {pendingChoice.result.candidates.map(task => (
              <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={task.title} disabled={busy} onPress={() => void pickTaskChoice(task.id)} style={({ pressed }) => StyleSheet.flatten([styles.linkButton, { alignSelf: 'stretch', justifyContent: 'flex-start', marginTop: spacing.sm }, pressed && styles.pressed])}>
                <AppIcon name="clipboard-text-outline" size={icon.sm} color={colors.primary} />
                <Text numberOfLines={2} style={styles.linkText}>{task.title}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {pendingWallet ? (
        <>
          <View style={styles.userBubbleRow}><View style={styles.userBubble}><Text style={styles.userBubbleText}>{pendingWallet.input}</Text></View></View>
          <View style={styles.execution}>
            {(() => {
              const waiting = pendingWallet.result.pending;
              const needsSource = pendingNeedsSource(waiting);
              const incoming = waiting.kind === 'INCOME' || (waiting.kind === 'NEW_DEBT' && waiting.direction === 'DEBT');
              return (
                <>
                  <View style={styles.cardHead}><AppIcon name="wallet-outline" size={icon.md} color={accents.green.on} /><Text style={styles.executionLabel}>{needsSource ? (bn ? 'মানিব্যাগ ও টাকার উৎস' : 'Wallet and source') : (bn ? 'কোন মানিব্যাগ?' : 'Which wallet?')}</Text></View>
                  {/* The same two questions every money form asks, with a new wallet made right here. */}
                  <WalletPicker
                    label={incoming ? (bn ? 'কোন মানিব্যাগে এলো' : 'Into which wallet') : (bn ? 'কোন মানিব্যাগ থেকে গেল' : 'Out of which wallet')}
                    value={cardWallet}
                    onChange={setCardWallet}
                    wallets={pendingWallet.result.wallets}
                    onWalletsChange={(ws) => setPendingWallet((p) => (p ? { ...p, result: { ...p.result, wallets: ws } } : p))}
                  />
                  {needsSource ? (
                    <FundSourcePicker value={cardSource} onChange={setCardSource} loanAccountId={cardLoan} onLoanAccountChange={setCardLoan} note={cardNote} onNoteChange={setCardNote} />
                  ) : null}
                  <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'রাখুন' : 'Save'} disabled={busy} onPress={() => void saveMoneyCard()} style={({ pressed }) => StyleSheet.flatten([styles.linkButton, { marginTop: spacing.md }, pressed && styles.pressed])}>
                    <AppIcon name="check" size={icon.sm} color={colors.primary} />
                    <Text numberOfLines={1} style={styles.linkText}>{bn ? 'রাখুন' : 'Save'}</Text>
                  </Pressable>
                </>
              );
            })()}
          </View>
        </>
      ) : null}

      {error ? <AppState title={bn ? 'অ্যাকশন চালানো যায়নি' : 'Action failed'} description={bn ? 'কাজটি করা যায়নি।' : 'The local action did not complete.'} icon="alert-circle-outline" actionLabel={copy.retry} onAction={() => void (isPlan ? runWholePlan() : execute())} /> : null}
    </ScrollView>
  );
}

function Detail({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

// "আজকের" / "গতকালের" / "আগামীকালের" / "১৫ সেপ্টেম্বরের" — the day a record belongs to, the
// way a person would say it back.
function dayPhrase(iso: string | null | undefined, bn: boolean): string {
  if (!iso) return '';
  // A stored instant is UTC ("…T18:00:00.000Z" is Dhaka's midnight of the NEXT day): the
  // day is read in the app's zone, never off the string (RC.4 QA T13).
  const key = iso.length > 10 ? bangladeshDateKey(iso) : iso.slice(0, 10);
  const offset = (d: number) => bangladeshDateKey(new Date(Date.now() + d * 86_400_000));
  if (key === offset(0)) return bn ? 'আজকের ' : "today's ";
  if (key === offset(-1)) return bn ? 'গতকালের ' : "yesterday's ";
  if (key === offset(1)) return bn ? 'আগামীকালের ' : "tomorrow's ";
  return bn ? `${formatBangladeshDate(`${key}T00:00:00`, 'bn')}-এর ` : `${formatBangladeshDate(`${key}T00:00:00`, 'en')} `;
}

// "আগামীকাল সকাল ৮:০০-এ" — when a reminder will fire, in the words it was asked in.
function repeatWord(r: string, bn: boolean): string {
  const words: Record<string, [string, string]> = { DAILY: ['প্রতিদিন', 'Every day'], WEEKDAYS: ['প্রতি কর্মদিবসে (রবি–বৃহস্পতি)', 'Every weekday (Sun–Thu)'], WEEKLY: ['প্রতি সপ্তাহে', 'Every week'], MONTHLY: ['প্রতি মাসে', 'Every month'] };
  const w = words[r];
  return w ? (bn ? w[0] : w[1]) : r;
}

function clockText(minutes: number, bn: boolean): string {
  const h = Math.floor(minutes / 60) % 24;
  const mm = String(minutes % 60).padStart(2, '0');
  const h12 = (h % 12) || 12;
  return bn ? `${bnDayPart(h)} ${asciiDigitsToBengali(`${h12}:${mm}`)}` : `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

function whenPhrase(dueAt: string | null | undefined, bn: boolean): string {
  if (!dueAt) return '';
  const day = dayPhrase(dueAt, bn).replace(/(?:ের|-এর)\s$/u, '').replace(/'s\s$/u, '').trim();
  if (dueAt.length <= 10) return day;
  // The stored instant is UTC; the hour is the app zone's (RC.4 QA T10: "…T05:30:00Z" was
  // read straight off the string and said "সকাল ৫:৩০" for a task set at 11:30).
  return bn ? `${day} ${formatBangladeshTime(dueAt, 'bn')}-এ` : `${day} at ${formatBangladeshTime(dueAt, 'en')}`;
}

function executionMessage(result: AssistantExecutionResult, bn: boolean): string {
  switch (result.type) {
    case 'TASK_CREATED': {
      if (result.task.recurrence && result.task.dueAt && result.task.dueAt.length > 10) {
        const every = repeatWord(result.task.recurrence, bn);
        const at = formatBangladeshTime(result.task.dueAt, bn ? 'bn' : 'en');
        const first = whenPhrase(result.task.dueAt, bn);
        return bn
          ? `"${result.task.title}" কাজটি যোগ হয়েছে — ${every} ${at}-এ মনে করিয়ে দেব (প্রথমবার ${first.replace(/-এ$/u, '')})।`
          : `Added "${result.task.title}" — I'll remind you ${every.toLowerCase()} at ${at} (first ${first}).`;
      }
      const when = whenPhrase(result.task.dueAt, bn);
      return bn
        ? `"${result.task.title}" কাজটি যোগ হয়েছে${when ? ` — ${when} মনে করিয়ে দেব` : ''}।`
        : `Added "${result.task.title}"${when ? ` — I'll remind you ${when}` : ''}.`;
    }
    case 'TASK_COMPLETED': return bn ? `"${result.task.title}" সম্পন্ন হিসেবে চিহ্নিত হয়েছে।` : `"${result.task.title}" is marked done.`;
    case 'TASK_RESCHEDULED': return bn ? 'কাজের সময় পরিবর্তন হয়েছে।' : 'The task was rescheduled.';
    case 'MEMORY_CREATED': return bn ? 'মেমোরিটি সংরক্ষণ করা হয়েছে।' : 'Your memory was saved.';
    case 'TASK_LIST': return result.tasks.length ? (bn ? `${bnNum(result.tasks.length)}টি কাজ পাওয়া গেছে।` : `Found ${bnNum(result.tasks.length)} task(s).`) : (bn ? 'কোনো কাজ নেই।' : 'No tasks yet.');
    case 'MEMORY_SEARCH': return result.memories.length ? (bn ? `${bnNum(result.memories.length)}টি মেমোরি পাওয়া গেছে।` : `Found ${bnNum(result.memories.length)} memory result(s).`) : (bn ? 'এই খোঁজে কোনো মেমোরি পাওয়া যায়নি।' : 'No memories matched that search.');
    case 'ANSWER': return result.answer.text;
    // Says the figure back. The one assistant action that writes money confirms in words
    // what was written, so a mishearing is caught at once rather than found in a total.
    case 'ENTRY_RECORDED': {
      const taka = (result.entry.amountPaisa / 100).toLocaleString(bn ? 'bn-BD' : 'en-US');
      const what = result.entry.kind === 'INCOME' ? (bn ? 'আয়' : 'income') : (bn ? 'খরচ' : 'expense');
      const day = dayPhrase(result.entry.occurredAt, bn);
      const cat = result.entry.category?.trim();
      return bn
        ? `${day}${cat ? `${cat} ` : ''}${what} হিসেবে ৳${taka} যোগ করা হয়েছে।`
        : `Added ৳${taka} to ${day}${what}${cat ? ` under ${cat}` : ''}.`;
    }
    case 'DEBT_CREATED': {
      const taka = (result.account.principalPaisa / 100).toLocaleString(bn ? 'bn-BD' : 'en-US');
      const what = result.account.direction === 'DEBT'
        ? (bn ? `${result.personName}-এর কাছ থেকে ধার` : `borrowed from ${result.personName}`)
        : (bn ? `${result.personName}-কে ধার` : `lent to ${result.personName}`);
      return bn ? `৳${taka} ${what} লেখা হয়েছে।` : `Recorded ৳${taka} ${what}.`;
    }
    case 'HELP': return result.intro;
    case 'SMALL_TALK': return result.message;
    case 'ANALYSIS': return result.message;
    case 'APP_REPLY': return result.message;
    default: return '';
  }
}

function ExecutionCard({ result, styles, copy, colors, bn, onExample, asked }: { result: AssistantExecutionResult; styles: ReturnType<typeof makeStyles>; copy: Record<string, string>; colors: ThemeColors; bn: boolean; onExample: (s: string) => void; asked?: string }) {
  const next = followUps(result, bn, asked);
  const isAnswer = result.type === 'ANSWER';
  const isHelp = result.type === 'HELP';
  const isTalk = result.type === 'SMALL_TALK';
  const answered = isAnswer && result.answer.type === 'ANSWER';
  const headIcon = isHelp ? 'lifebuoy' : isTalk ? 'chat-outline' : isAnswer ? (answered ? 'lightbulb-outline' : 'information-outline') : 'check-decagram';
  const headLabel = isHelp ? (bn ? 'আমি যা করতে পারি' : 'What I can do') : isTalk ? (bn ? 'আপন' : 'Apon') : isAnswer ? (bn ? 'উত্তর' : 'Answer') : result.type === 'ANALYSIS' ? (bn ? 'খরচ বিশ্লেষণ' : 'Spending analysis') : result.type === 'APP_REPLY' ? (bn ? 'অ্যাপ থেকে' : 'From the app') : copy.completed;
  return (
    <View style={styles.execution}>
      <View style={styles.cardHead}><AppIcon name={headIcon} size={icon.md} color={colors.success} /><Text style={styles.executionLabel}>{headLabel}</Text></View>
      <Text style={styles.executionMessage}>{executionMessage(result, bn)}</Text>
      {/* Who wrote this answer — set in ai-action-executor's trace. */}
      {(() => {
        const trace = result.type === 'ANSWER' ? (result.answer.trace ?? []) : result.type === 'ANALYSIS' ? result.trace : null;
        if (!trace) return null;
        if (trace.includes('llm-polished') || trace.includes('llm-general')) {
          const ms = Number(trace.find((t) => t.startsWith('llm-ms:'))?.slice(7) ?? 0);
          return <Text style={[styles.listMeta, { color: colors.success }]}>✨ {bn ? 'AI দিয়ে লেখা' : 'Written by the AI'}{ms ? ` · ${(ms / 1000).toFixed(1)} ${bn ? 'সে.' : 's'}` : ''}</Text>;
        }
        const fallback = trace.find((t) => t.startsWith('llm-fallback:'));
        if (fallback) {
          return <Text style={styles.listMeta}>⚙️ {bn ? 'সাধারণ উত্তর — ' : 'Built-in answer — '}{bn ? 'আপনার সংরক্ষিত তথ্যের ভিত্তিতে' : 'from your saved information'}</Text>;
        }
        return null;
      })()}
      {isHelp ? (
        <>
          {result.topics.map(t => (
            <View key={t.title} style={styles.listItemRow}>
              <AppIcon name="check-circle-outline" size={icon.xs} color={colors.primary} />
              <View style={styles.listItemCopy}>
                <Text style={styles.listItem}>{t.title}</Text>
                <Text style={styles.listMeta}>{t.detail}</Text>
                {t.example ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t.example} onPress={() => onExample(t.example!)} style={({ pressed }) => StyleSheet.flatten([styles.suggestChip, { marginTop: spacing.xs }, pressed && styles.pressed])}>
                    <AppIcon name="lightbulb-outline" size={icon.xs} color={colors.primary} />
                    <Text style={styles.suggestChipText}>{t.example}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
          <Text style={[styles.listMeta, { marginTop: spacing.md }]}>{result.outro}</Text>
        </>
      ) : null}
      {isAnswer && result.answer.sources.length ? result.answer.sources.map(src => (
        
          <Pressable key={src.id} onPress={() => router.push({ pathname: src.origin === 'TASK' ? '/task-detail' : '/memory-detail', params: { id: src.id } } as never)}  accessibilityRole="button" accessibilityLabel={`${bn ? 'খুলুন' : 'Open'} ${src.snippet}`} style={({ pressed }) => StyleSheet.flatten([styles.listItemRow, pressed && styles.pressed])}>
            <AppIcon name={src.origin === 'TASK' ? 'clipboard-text-outline' : 'bookmark-outline'} size={icon.xs} color={colors.primary} />
            <View style={styles.listItemCopy}><Text style={styles.listItem}>{src.snippet}</Text><Text style={styles.listMeta}>{bn ? 'সূত্র' : 'source'} · {src.origin === 'TASK' ? (bn ? 'কাজ' : 'task') : (bn ? 'নোট' : 'note')} · {Math.round(result.answer.confidence * 100)}% · {bn ? 'খুলতে ট্যাপ করুন' : 'tap to open'}</Text></View>
            <AppIcon name="chevron-right" size={icon.xs} color={colors.textMuted} />
          </Pressable>
      )) : null}
      {result.type === 'TASK_LIST' ? result.tasks.slice(0, 10).map(task => (
        
          <Pressable key={task.id} onPress={() => router.push({ pathname: '/task-detail', params: { id: task.id } } as never)}  accessibilityRole="button" accessibilityLabel={`${bn ? 'কাজ খুলুন' : 'Open task'} ${task.title}`} style={({ pressed }) => StyleSheet.flatten([styles.listItemRow, pressed && styles.pressed])}>
            <AppIcon name="clipboard-text-outline" size={icon.xs} color={colors.primary} />
            <View style={styles.listItemCopy}><Text style={styles.listItem}>{task.title}</Text><Text style={styles.listMeta}>{localizeTaskStatus(task.status, bn)} · {localizeTaskPriority(task.priority, bn)}</Text></View>
            <AppIcon name="chevron-right" size={icon.xs} color={colors.textMuted} />
          </Pressable>
      )) : null}
      {result.type === 'MEMORY_SEARCH' ? result.memories.slice(0, 10).map(memory => (
        
          <Pressable key={memory.id} onPress={() => router.push({ pathname: '/memory-detail', params: { id: memory.id } } as never)}  accessibilityRole="button" accessibilityLabel={`${bn ? 'মেমোরি খুলুন' : 'Open memory'} ${memory.content}`} style={({ pressed }) => StyleSheet.flatten([styles.listItemRow, pressed && styles.pressed])}>
            <AppIcon name={memoryKindIcon(memory.kind)} size={icon.xs} color={colors.primary} />
            <View style={styles.listItemCopy}><Text style={styles.listItem}>{memory.content}</Text><Text style={styles.listMeta}>{localizeMemoryKind(memory.kind, bn)} · {bn ? 'গুরুত্ব' : 'importance'} {memory.importance}</Text></View>
            <AppIcon name="chevron-right" size={icon.xs} color={colors.textMuted} />
          </Pressable>
      )) : null}
      <View style={styles.executionLinks}>
        {result.type === 'APP_REPLY' && result.open ? <Pressable onPress={() => router.push(SCREENS[result.open!].route as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}><AppIcon name="arrow-top-right" size={icon.sm} color={colors.primary} /><Text style={styles.linkText}>{bn ? `${SCREENS[result.open].bn} খুলুন` : `Open ${SCREENS[result.open].en}`}</Text></Pressable> : null}
        {next.length ? (
          <View style={styles.followUps}>
            {next.map((s) => (
              <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => onExample(s)} style={({ pressed }) => StyleSheet.flatten([styles.suggestChip, pressed && styles.pressed])}>
                <AppIcon name="arrow-right-circle-outline" size={icon.xs} color={colors.primary} />
                <Text style={styles.suggestChipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {result.type === 'TASK_LIST' ? <Pressable onPress={() => router.push("/planning" as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}><AppIcon name="calendar-check-outline" size={icon.sm} color={colors.primary} /><Text style={styles.linkText}>{copy.planning}</Text></Pressable> : null}
        {result.type === 'MEMORY_CREATED' ? <Pressable onPress={() => router.push({ pathname: '/memory-detail', params: { id: result.memory.id } } as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}><AppIcon name="bookmark-outline" size={icon.sm} color={colors.primary} /><Text style={styles.linkText}>{copy.memoryOpen}</Text></Pressable> : null}
        {result.type === 'DEBT_CREATED' ? <Pressable onPress={() => router.push({ pathname: '/debt/account/[id]', params: { id: result.account.id } } as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}><AppIcon name="wallet-outline" size={icon.sm} color={colors.primary} /><Text style={styles.linkText}>{bn ? 'হিসাব দেখুন' : 'View account'}</Text></Pressable> : null}
        {result.type === 'MEMORY_SEARCH' ? <Pressable onPress={() => router.push("/memory" as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.linkButton, pressed && styles.pressed])}><AppIcon name="bookmark-outline" size={icon.sm} color={colors.primary} /><Text style={styles.linkText}>{copy.memoryOpen}</Text></Pressable> : null}
      </View>
    </View>
  );
}

function PlanCard({ plan, run, busy, bn, styles, colors, accents, onRun }: {
  plan: TurnPlan;
  run: PlanRun | null;
  busy: boolean;
  bn: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  accents: ThemeAccents;
  onRun: () => void;
}) {
  const stateFor = (id: number) => run?.outcomes.find(o => o.id === id)?.state;
  const badge = (state: string | undefined) => {
    if (state === 'DONE') return { icon: 'check-circle-outline' as const, color: colors.success, text: bn ? 'হয়েছে' : 'done' };
    if (state === 'FAILED') return { icon: 'alert-circle-outline' as const, color: colors.danger, text: bn ? 'ব্যর্থ' : 'failed' };
    if (state === 'SKIPPED') return { icon: 'minus-circle-outline' as const, color: colors.textMuted, text: bn ? 'বাদ' : 'skipped' };
    if (state === 'WAITING') return { icon: 'wallet-outline' as const, color: colors.textMuted, text: bn ? 'মানিব্যাগ বাকি' : 'needs a wallet' };
    return null;
  };
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadIcon}><AppIcon name="format-list-checks" size={icon.md} color={accents.purple.on} /></View>
        <Text style={styles.cardEyebrow}>{bn ? `কর্মপরিকল্পনা · ${plan.readyCount}টি ধাপ` : `Plan · ${plan.readyCount} steps`}</Text>
      </View>
      {plan.steps.map(step => {
        const b = badge(stateFor(step.id));
        const skip = step.status !== 'READY';
        return (
          <View key={step.id} style={styles.stepRow}>
            <View style={[styles.stepIndex, skip && styles.stepIndexMuted]}><Text style={styles.stepIndexText}>{step.id + 1}</Text></View>
            <View style={styles.listItemCopy}>
              <Text style={[styles.stepText, skip && styles.stepTextMuted]}>{describeAction(step.action, bn)}</Text>
              {skip ? <Text style={styles.listMeta}>{bn ? 'এই ধাপে আরও তথ্য দরকার — বাদ যাবে' : 'needs more detail — will be skipped'}</Text> : null}
            </View>
            {b ? <View style={styles.stepBadge}><AppIcon name={b.icon} size={icon.xs} color={b.color} /><Text style={[styles.stepBadgeText, { color: b.color }]}>{b.text}</Text></View> : null}
          </View>
        );
      })}
      {run ? (
        <Text style={styles.planSummary}>
          {run.status === 'COMPLETED' ? (bn ? 'সব ধাপ সম্পন্ন হয়েছে।' : 'All steps completed.')
            : run.status === 'PARTIAL' ? (bn ? 'কিছু ধাপ সম্পন্ন হয়েছে।' : 'Some steps completed.')
            : (bn ? 'কোনো ধাপ সম্পন্ন হয়নি।' : 'No steps completed.')}
        </Text>
      ) : (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} onPress={onRun} style={({ pressed }) => StyleSheet.flatten([styles.executeButton, busy && styles.disabled, pressed && styles.pressed])}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="play" size={icon.sm} color={colors.onPrimary} /><Text style={styles.executeText}>{bn ? 'সব ধাপ চালান' : 'Run all steps'}</Text></>}
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.lg },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    titleIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.lg, backgroundColor: accents.purple.soft, alignItems: 'center', justifyContent: 'center' },
    titleCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '900', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '900', marginTop: spacing.xxs },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.md },
    voiceHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginTop: spacing.sm },
    voiceHintText: { color: colors.textMuted, ...typography.caption },
    inputBox: { position: 'relative', minHeight: spacing.xxl + control.inputHeight, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, ...elevation.card },
    input: { flex: 1, minWidth: 0, maxHeight: 168, minHeight: spacing.xxl + spacing.lg + spacing.smd, color: colors.textPrimary, ...typography.body, textAlignVertical: 'top' },
    photoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    photoBtn: { flex: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    photoBtnText: { flexShrink: 1, color: colors.primary, ...typography.meta, fontWeight: '800' },
    photoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
    photoNoteText: { flex: 1, color: colors.textMuted, ...typography.caption },
    micButton: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    micButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    aiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
    voiceTag: { alignSelf: 'flex-start', marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    voiceTagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
    voiceTagText: { color: colors.primary, ...typography.caption, fontWeight: '700' },
    voiceNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm, paddingHorizontal: spacing.smd, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: border.thin, borderColor: accents.orange.border, backgroundColor: accents.orange.soft },
    voiceNoteText: { flex: 1, minWidth: 0, color: accents.orange.on, ...typography.caption, fontWeight: '700' },
    card: { marginTop: spacing.lg, borderWidth: border.thin, borderColor: accents.purple.border, borderRadius: radius.lg, backgroundColor: accents.purple.soft, padding: spacing.lg },
    cardMuted: { borderColor: colors.border, backgroundColor: colors.surface },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardHeadIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    cardEyebrow: { color: accents.purple.on, ...typography.section, fontWeight: '900', letterSpacing: 0.8 },
    plain: { color: colors.textPrimary, ...typography.body, marginTop: spacing.md },
    actionTitle: { color: colors.textPrimary, ...typography.heading, fontWeight: '900', marginTop: spacing.smd },
    detail: { marginTop: spacing.md },
    detailLabel: { color: colors.textMuted, ...typography.section, fontWeight: '800' },
    detailValue: { color: colors.textPrimary, ...typography.meta, marginTop: spacing.xxs, fontWeight: '700' },
    clarifyBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg, padding: spacing.sm, borderRadius: radius.md, backgroundColor: accents.blue.soft, borderWidth: border.thin, borderColor: accents.blue.border },
    clarifyText: { flex: 1, color: accents.blue.on, ...typography.bodySmall, fontWeight: '700' },
    executeButton: { minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, flexDirection: 'row', gap: spacing.xs },
    executeText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '900' },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
    userBubbleRow: { alignItems: 'flex-end', marginTop: spacing.md },
    userBubble: { maxWidth: '85%', backgroundColor: colors.primary, borderRadius: radius.lg, borderBottomRightRadius: radius.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    userBubbleText: { color: colors.onPrimary, ...typography.bodySmall },
    pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.smd, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    pendingText: { flex: 1, color: colors.textSecondary, ...typography.bodySmall, fontWeight: '700' },
    adviceBox: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.sm },
    adviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: border.thin, borderRadius: radius.md, padding: spacing.md },
    adviceBody: { flex: 1, minWidth: 0, gap: 2 },
    adviceText: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    adviceDetail: { color: colors.textSecondary, ...typography.caption },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    suggestLabel: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, marginTop: spacing.md },
    suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', marginTop: spacing.xs },
    suggestChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, maxWidth: 260, minHeight: layout.minTouchTarget, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    suggestChipText: { flexShrink: 1, color: colors.textPrimary, ...typography.caption },
    empty: { color: colors.textSecondary, textAlign: 'center', ...typography.bodySmall },
    execution: { marginTop: spacing.lg, borderWidth: border.thin, borderColor: accents.green.border, borderRadius: radius.xl, backgroundColor: accents.green.soft, padding: spacing.lg },
    executionLabel: { color: colors.success, ...typography.section, fontWeight: '900', letterSpacing: 0.8 },
    executionMessage: { color: colors.textPrimary, ...typography.body, fontWeight: '800', marginTop: spacing.xs },
    listItemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
    listItemCopy: { flex: 1, minWidth: 0 },
    listItem: { color: colors.textPrimary, ...typography.bodySmall },
    listMeta: { color: colors.textMuted, ...typography.section, marginTop: spacing.xxs },
    executionLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    linkButton: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    followUps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    abilityGrid: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
    abilityCard: { flexBasis: '48%', flexGrow: 1, gap: spacing.xxs, padding: spacing.smd, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    abilityHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
    abilityTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
    abilityExample: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingVertical: spacing.xxs },
    abilityExampleText: { ...typography.bodySmall, color: colors.primary },
    linkText: { color: colors.primary, fontWeight: '800' },
    stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
    stepIndex: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.pill, backgroundColor: accents.purple.soft, alignItems: 'center', justifyContent: 'center' },
    stepIndexMuted: { backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border },
    stepIndexText: { color: accents.purple.on, ...typography.section, fontWeight: '900' },
    stepText: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    stepTextMuted: { color: colors.textMuted, fontWeight: '600' },
    stepBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
    stepBadgeText: { ...typography.caption, fontWeight: '900' },
    planSummary: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', marginTop: spacing.lg },
  });
}

/**
 * What আপন is doing right now, in words (rc.16 review H11): the step it is on, not a
 * warning about how long it might take. After a few seconds a question that goes to the AI
 * says so — "AI উত্তর তৈরি করছি…" — because that is when the waiting really starts.
 */
function PendingStage({ type, aiOn, bn, style }: { type?: string; aiOn: boolean; bn: boolean; style: object }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  const text = type === 'APP_QUERY' ? (bn ? 'হিসাব মিলিয়ে দেখছি…' : 'Checking your records…')
    : type === 'ANALYZE_SPENDING' ? (bn ? 'খরচ বিশ্লেষণ করছি…' : 'Analysing your spending…')
      : type === 'SEARCH_MEMORY' || type === 'LIST_TASKS' ? (bn ? 'আপনার তথ্য খুঁজছি…' : 'Looking through your information…')
        : late && aiOn ? (bn ? 'AI উত্তর তৈরি করছি… একটু সময় লাগতে পারে' : 'The AI is writing an answer… it can take a little while')
          : (bn ? 'প্রশ্নটি বুঝে তথ্য খুঁজছি…' : 'Understanding the question and looking…');
  return <Text style={style}>{text}</Text>;
}
