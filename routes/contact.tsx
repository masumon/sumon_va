import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { va, type Contact, type Message, errTone } from '../src/va/api';
import { useAppActive, useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { BrandLogo, brandFor, brandName } from '../src/va/BrandLogo';
import { TagEditor } from '../src/va/TagEditor';
import { ChatTransfer } from '../src/va/ChatTransfer';
import { HistoryImport } from '../src/va/HistoryImport';
import { ContactMemory } from '../src/va/ContactMemory';
import { ChatMenuButton } from '../src/va/ChatMenu';
import { AppIcon } from '../src/ui/AppIcon';
import { CATEGORY, CATEGORY_KEYS, CHANNEL, MESSAGE_STATUS, MODE, PRIORITY, displayName } from '../src/va/labels';
import { autoSendInApp, hasReplyBox, isAccessibilityEnabled, openAccessibilitySettings, openChat, phoneNumberFor, sendDirectSms } from '../modules/va-bridge';

const MODES: Contact['mode'][] = ['inherit', 'auto', 'telegram', 'draft', 'notify'];
type DraftTone = 'auto' | 'short' | 'warm' | 'formal';
type FallbackMethod = 'app' | 'sms' | 'auto';
const FALLBACK_OPTIONS: { key: FallbackMethod; bn: string; en: string }[] = [
  { key: 'app', bn: 'অ্যাপে খুলে পাঠান', en: 'Open in app' },
  { key: 'sms', bn: 'SMS বিকল্প', en: 'SMS fallback' },
  { key: 'auto', bn: 'অটো-Send (অ্যাক্সেসিবিলিটি)', en: 'Auto-Send (Accessibility)' },
];

function pkgForContact(c: Contact): string {
  if (c.phone.startsWith('notif:')) return c.phone.split(':')[1] ?? '';
  if (c.channel === 'whatsapp') return 'com.whatsapp';
  if (c.channel === 'telegram') return 'org.telegram.messenger';
  return '';
}

function targetNameFor(c: Contact): string {
  if (c.name?.trim()) return c.name.trim();
  const tail = c.phone.split(':').slice(-1)[0] ?? '';
  return tail.trim();
}
const DRAFT_TONES: { key: DraftTone; bn: string; en: string }[] = [
  { key: 'auto', bn: 'স্বাভাবিক', en: 'Natural' },
  { key: 'short', bn: 'ছোট', en: 'Short' },
  { key: 'warm', bn: 'আন্তরিক', en: 'Warm' },
  { key: 'formal', bn: 'ভদ্র', en: 'Formal' },
];

/** WhatsApp-style ticks for what we sent: clock = on its way, ✓ = left us, ✓✓ = reached their phone, blue ✓✓ = they read it, ! = failed. */
function Ticks({ m }: { m: Message }) {
  const { colors } = useKit();
  if (m.status === 'failed') return <AppIcon name="alert-circle-outline" size={15} color={colors.danger} />;
  if (m.status === 'queued' || m.status === 'sending') return <AppIcon name="clock-outline" size={14} color={colors.textMuted} />;
  if (m.delivery === 'read') return <AppIcon name="check-all" size={16} color="#34B7F1" />;
  if (m.delivery === 'delivered') return <AppIcon name="check-all" size={16} color={colors.textMuted} />;
  if (m.status === 'sent') return <AppIcon name="check" size={16} color={colors.textMuted} />;
  return null;
}

function Bubble({ m, onRetryApp, onRetrySms, onRetryAuto }: { m: Message; onRetryApp?: (msgText: string) => void; onRetrySms?: (msgText: string) => void; onRetryAuto?: (msgText: string) => void }) {
  const { colors, bn, language } = useKit();
  const mine = m.direction === 'out';
  const st = MESSAGE_STATUS[m.status] ?? { bn: String(m.status ?? ''), en: String(m.status ?? '') };
  const text = m.transcript || m.body || (bn ? '(লেখা নেই)' : '(no text)');
  const showRetry = mine && m.status === 'failed' && Boolean(m.body?.trim()) && (onRetryApp || onRetrySms || onRetryAuto);
  const inTag = m.body === '[মিসড কল]' || m.kind === 'call'
    ? (bn ? '📞 মিসড কল' : '📞 Missed call')
    : m.kind === 'audio'
      ? (bn ? '🎤 ভয়েস মেসেজ' : '🎤 Voice note')
      : m.kind === 'image'
        ? (bn ? '📷 ছবি বিশ্লেষণ' : '📷 Image')
        : m.kind === 'video'
          ? (bn ? '🎥 ভিডিও বিশ্লেষণ' : '🎥 Video')
          : (bn ? '💬 বার্তা' : '💬 Message');
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 4 }}>
      <View
        style={{
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: mine ? colors.primary : colors.border,
          backgroundColor: mine ? colors.primaryTint : colors.surface,
          gap: 4,
        }}
      >
        {!mine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.primary }}>{inTag}</Text>
            <Text style={{ fontSize: 10.5, color: colors.textMuted }}>
              {m.created_at ? formatBangladeshDateTime(m.created_at, language) : ''}
            </Text>
          </View>
        ) : null}
        <Text style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 21 }}>{text}</Text>
        {mine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
            <Text style={{ color: m.status === 'failed' ? colors.danger : colors.textMuted, fontSize: 10.5 }}>
              {m.created_at ? formatBangladeshDateTime(m.created_at, language) : ''}
              {` · ${bn ? (m.delivery === 'read' ? 'পড়েছেন' : m.delivery === 'delivered' ? 'পৌঁছেছে' : st.bn) : (m.delivery === 'read' ? 'Read' : m.delivery === 'delivered' ? 'Delivered' : st.en)}`}
              {m.tag ? ` · ${m.tag}` : ''}{m.error ? ` · ${m.error}` : ''}
            </Text>
            <Ticks m={m} />
          </View>
        ) : null}
      </View>
      {showRetry ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
          {onRetryApp ? (
            <Pressable accessibilityRole="button" onPress={() => onRetryApp(m.body!)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface }}>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '700' }}>{bn ? 'অ্যাপে খুলে পাঠান' : 'Open in app'}</Text>
            </Pressable>
          ) : null}
          {onRetrySms ? (
            <Pressable accessibilityRole="button" onPress={() => onRetrySms(m.body!)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '700' }}>{bn ? 'SMS পাঠান' : 'Send SMS'}</Text>
            </Pressable>
          ) : null}
          {onRetryAuto ? (
            <Pressable accessibilityRole="button" onPress={() => onRetryAuto(m.body!)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '700' }}>{bn ? 'অটো-Send' : 'Auto-Send'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function ContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { bn, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const appActive = useAppActive();
  const detail = useLoad(() => va.contact(String(id)), `contact:${String(id)}`, 10000);
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config', 60000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [aliasText, setAliasText] = useState('');
  const [showRules, setShowRules] = useState(false); // top quick-rules stay folded in a 1-line bar so message bubbles appear immediately
  const [more, setMore] = useState(false); // the person's details and rules stay folded, so the chat page stays simple
  const [draftMeta, setDraftMeta] = useState<{ pattern: string; source: 'ai' | 'rules'; tone: DraftTone; note?: string; warning?: string } | null>(null);
  const [draftAvoid, setDraftAvoid] = useState<string[]>([]);
  const [draftVariant, setDraftVariant] = useState(0);
  const [draftHint, setDraftHint] = useState('');
  const [fallbacks, setFallbacks] = useState<FallbackMethod[]>(['app']);
  const a11yOn = appActive ? isAccessibilityEnabled() : isAccessibilityEnabled();
  const aliases = useLoad(() => va.aliases(String(id)), `aliases:${String(id)}`, 60000);

  useEffect(() => {
    let alive = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', [`reply_via:${String(id)}`]).then((row) => {
      if (!alive || !row?.value) return;
      try {
        const arr = JSON.parse(row.value) as unknown;
        if (Array.isArray(arr)) {
          const clean = arr.filter((x): x is FallbackMethod => x === 'app' || x === 'sms' || x === 'auto');
          setFallbacks(clean);
        }
      } catch { /* ignore */ }
    }).catch(() => {});
    return () => { alive = false; };
  }, [db, id]);

  const toggleFallback = (m: FallbackMethod) => {
    setFallbacks((prev) => {
      const next = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m];
      void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', [`reply_via:${String(id)}`, JSON.stringify(next)]).catch(() => {});
      return next;
    });
  };

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await detail.reload(); if (ok) showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  const writeDraft = (opts?: { tone?: DraftTone; another?: boolean }) => {
    if (!c || busy) return;
    const isRetry = Boolean(opts?.another || opts?.tone);
    const tone: DraftTone = opts?.tone ?? draftMeta?.tone ?? 'auto';
    const nextAvoid = isRetry ? [...draftAvoid, text.trim()].filter(Boolean).slice(-3) : [];
    const nextVariant = opts?.another ? draftVariant + 1 : opts?.tone ? draftVariant : 0;
    const instruction = isRetry ? draftHint : text.trim();
    if (!isRetry) setDraftHint(text.trim());
    void act(async () => {
      const r = await va.suggest(c.id, { instruction, tone, avoid: nextAvoid, variant: nextVariant });
      const draft = (r.text ?? r.reply ?? '').trim();
      if (draft) {
        setText(draft);
        setDraftAvoid(nextAvoid);
        setDraftVariant(nextVariant);
        setDraftMeta({ pattern: r.pattern ?? '', source: r.source ?? 'ai', tone: r.tone ?? tone, note: r.note, warning: r.warning });
      }
      if (r.warning) showSnackbar(r.warning, 'info');
      else if (draft) showSnackbar(bn ? '✓ খসড়া লেখা হয়েছে — পছন্দ না হলে “আরেকটি লিখুন” চাপুন' : '✓ Draft ready — tap Another if you want a new one', 'success');
    });
  };

  const c = detail.data?.contact;
  const ac = cfg.data?.config;
  const drafts = (detail.data?.messages ?? []).filter((m) => m.status === 'draft');
  const pr = c ? (PRIORITY[c.priority] ?? PRIORITY[5]!) : null;
  const chatPkg = c ? pkgForContact(c) : '';
  const chatName = c ? targetNameFor(c) : '';
  const smsNumber = c ? (phoneNumberFor(chatName) || phoneNumberFor(c.phone.split(':').slice(-1)[0] ?? '')) : '';

  const clearComposer = () => { setText(''); setDraftMeta(null); setDraftAvoid([]); setDraftVariant(0); setDraftHint(''); };

  const sendViaOpenApp = (msgText: string, clearAfter = false) => {
    if (!c || !chatPkg || !msgText.trim()) return;
    const res = openChat(chatPkg, chatName, msgText.trim());
    if (res.how === 'none') {
      showSnackbar(bn ? 'এই চ্যাট-অ্যাপটি খোলা যায়নি' : 'Could not open this chat app', 'danger');
      return;
    }
    if (clearAfter) clearComposer();
    void va.sentByHand(c.id, msgText.trim()).then(() => detail.reload()).catch(() => {});
    showSnackbar(
      res.how === 'chat'
        ? (bn ? 'সরাসরি চ্যাট খুলে উত্তর বসানো হয়েছে — শুধু Send চাপুন' : 'Chat opened with your reply — tap Send')
        : (bn ? 'উত্তর কপি করে অ্যাপ খোলা হয়েছে — মানুষটি বেছে Paste/Send করুন' : 'Reply copied & app opened — pick contact and send'),
      'info'
    );
  };

  const sendViaSms = (msgText: string, clearAfter = false) => {
    if (!c || !msgText.trim()) return;
    const target = smsNumber || chatName;
    const res = sendDirectSms(target, msgText.trim());
    if (!res.ok) {
      showSnackbar(res.error || (bn ? 'SMS পাঠানো যায়নি' : 'Could not send SMS'), 'danger');
      return;
    }
    if (clearAfter) clearComposer();
    void act(() => va.sentByHand(c.id, `[SMS] ${msgText.trim()}`), bn ? `✓ SMS পাঠানো হয়েছে (${res.number ?? target})` : `✓ SMS sent (${res.number ?? target})`);
  };

  const sendViaAutoClick = (msgText: string, clearAfter = false) => {
    if (!c || !chatPkg || !msgText.trim()) return;
    if (!isAccessibilityEnabled()) {
      showSnackbar(bn ? 'অটো-Send চালাতে আগে Android Accessibility চালু করুন' : 'Enable Android Accessibility first for Auto-Send', 'info');
      openAccessibilitySettings();
      return;
    }
    const res = autoSendInApp(chatPkg, chatName, msgText.trim());
    if (res.armed) {
      if (clearAfter) clearComposer();
      void va.sentByHand(c.id, msgText.trim()).then(() => detail.reload()).catch(() => {});
      showSnackbar(bn ? '✓ চ্যাট খুলে অটো-Send চালু করা হয়েছে' : '✓ Chat opened with Auto-Send armed', 'success');
    } else if (res.how !== 'none') {
      if (clearAfter) clearComposer();
      showSnackbar(bn ? 'নম্বর না থাকায় সরাসরি চ্যাট মেলেনি — নিরাপত্তার জন্য নিজে মানুষটি বেছে Send চাপুন' : 'Number not found — pick the contact yourself and tap Send', 'info');
    } else {
      showSnackbar(bn ? 'অটো-Send চালু করা যায়নি' : 'Could not start Auto-Send', 'danger');
    }
  };

  const sendSmart = () => {
    if (!c || !text.trim() || busy) return;
    const msg = text.trim();
    if (c.channel === 'notif' && !hasReplyBox(c.phone)) {
      if (fallbacks.includes('auto') && chatPkg && isAccessibilityEnabled()) { sendViaAutoClick(msg, true); return; }
      if (fallbacks.includes('app') && chatPkg) { sendViaOpenApp(msg, true); return; }
      if (fallbacks.includes('sms') && smsNumber) { sendViaSms(msg, true); return; }
    }
    void act(async () => { await va.reply(c.id, msg); clearComposer(); }, bn ? 'পাঠানোর জন্য দেওয়া হয়েছে' : 'Handed over for sending');
  };
  const replyExplain = !c ? '' : !ac ? ''
    : !ac.enabled ? (bn ? 'মূল সহকারী বন্ধ থাকায় এখন অটো উত্তর বা খসড়া কিছুই তৈরি হবে না।' : 'Main assistant is off — no auto-replies or drafts will be made.')
    : c.is_blocked ? (bn ? 'ব্লক করা: এই মানুষের কোনো উত্তর বা খসড়া তৈরি হবে না।' : 'Blocked: no replies or drafts will be made.')
    : (c.is_family || c.category === 'personal') ? (bn ? 'পরিবার ও ব্যক্তিগত চ্যাটে নিরাপত্তার কারণে অটো উত্তর বন্ধ থাকে; শুধু আপনাকে জানাবে।' : 'Auto-reply stays off for family and personal chats; you are notified only.')
    : c.category === 'spam' ? (bn ? 'স্প্যাম: এখানে কোনো অটো উত্তর বা অ্যালার্ট যাবে না।' : 'Spam: no auto-replies or alerts.')
    : c.mode === 'auto' ? (bn ? `✓ অটো উত্তর চালু${ac.ai.enabled ? ' (AI বুঝে উত্তর দেবে)' : ' (শুধু আপনার নিয়মে উত্তর দেবে)'}` : `✓ Auto-reply on${ac.ai.enabled ? ' (AI enabled)' : ' (rules only)'}`)
    : c.mode === 'telegram' ? (bn ? 'Telegram বট মোড: খসড়া আপনার বটে যাবে, আপনি “পাঠান” চাপলে তবেই যাবে।' : 'Telegram bot mode: drafts go to your bot for approval.')
    : c.mode === 'draft' ? (bn ? 'ম্যানুয়াল মোড: সহকারী খসড়া লিখে রাখবে, আপনি দেখে পাঠালে তবেই যাবে।' : 'Manual mode: assistant prepares drafts for you to send.')
    : c.mode === 'notify' ? (bn ? 'শুধু জানাবে: কোনো অটো উত্তর বা খসড়া তৈরি হবে না।' : 'Notify only: no auto-replies or drafts.')
    : (bn ? `অ্যাপের সাধারণ নিয়মে চলবে (${ac.mode === 'auto' ? 'অটো চালু' : 'শুধু খসড়া'}${ac.ai.enabled ? ' · AI চালু' : ' · AI বন্ধ'})।` : `Follows app default (${ac.mode === 'auto' ? 'auto' : 'drafts'}${ac.ai.enabled ? ' · AI on' : ' · AI off'}).`);

  return (
    <Page title={c ? displayName(c) : '…'} subtitle={c ? (bn ? CHANNEL[c.channel]?.bn : CHANNEL[c.channel]?.en) ?? c.channel : undefined} back={bn ? 'ইনবক্স' : 'Inbox'} right={c ? <ChatMenuButton contact={c} onChanged={() => void detail.reload()} size={26} /> : null} onRefresh={detail.reload} refreshing={detail.loading && !!detail.data}
      footer={c ? (
        <View style={{ gap: 8 }}>
          {draftMeta ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {draftMeta.pattern ? <AppBadge label={bn ? `ধরন: ${draftMeta.pattern}` : draftMeta.pattern} tone="primary" /> : null}
                <AppBadge label={draftMeta.source === 'ai' ? 'AI' : (bn ? 'নিয়ম' : 'Rules')} tone="neutral" />
              </View>
              <ChipGroup<DraftTone>
                options={DRAFT_TONES.map((t) => t.key)}
                value={draftMeta.tone}
                labelOf={(k) => { const t = DRAFT_TONES.find((x) => x.key === k); return t ? (bn ? t.bn : t.en) : k; }}
                onChange={(t) => { if (t) writeDraft({ tone: t }); }}
              />
              {draftMeta.note ? <Text style={{ fontSize: 11, opacity: 0.75 }}>{draftMeta.note}</Text> : null}
            </View>
          ) : null}
          <Field label="" value={text} onChangeText={(v) => { setText(v); if (!v.trim()) { setDraftMeta(null); setDraftAvoid([]); setDraftVariant(0); } }} multiline placeholder={bn ? 'আপনার উত্তর লিখুন, অথবা একটু হিন্ট লিখে “সহকারী লিখে দিক” চাপুন…' : 'Write your reply, or add a hint and tap Let it write…'} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><AppButton label={bn ? 'পাঠান' : 'Send'} icon="send" loading={busy} disabled={!text.trim()}
              onPress={sendSmart} /></View>
            <View style={{ flex: 1 }}><AppButton variant="secondary" icon={draftMeta ? 'refresh' : 'auto-fix'} label={draftMeta ? (bn ? 'আরেকটি লিখুন' : 'Write another') : (bn ? 'সহকারী লিখে দিক' : 'Let it write')} loading={busy}
              onPress={() => writeDraft(draftMeta ? { another: true } : undefined)} /></View>
          </View>
          {text.trim() && fallbacks.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {fallbacks.includes('app') && chatPkg ? (
                <Pressable accessibilityRole="button" onPress={() => sendViaOpenApp(text, true)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>{bn ? 'অ্যাপে খুলে পাঠান' : 'Open in app'}</Text>
                </Pressable>
              ) : null}
              {fallbacks.includes('sms') && smsNumber ? (
                <Pressable accessibilityRole="button" onPress={() => sendViaSms(text, true)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '600' }}>{bn ? 'SMS পাঠান' : 'Send SMS'}</Text>
                </Pressable>
              ) : null}
              {fallbacks.includes('auto') && chatPkg ? (
                <Pressable accessibilityRole="button" onPress={() => sendViaAutoClick(text, true)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 12, color: colors.textPrimary, fontWeight: '600' }}>{bn ? 'অটো-Send' : 'Auto-Send'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}>
      <Status loading={detail.loading && !detail.data} error={detail.data ? null : detail.error} onRetry={detail.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c && pr ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <BrandLogo brand={brandFor(c.channel, c.phone)} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{brandName(brandFor(c.channel, c.phone))} · {c.phone.split(':').slice(-1)[0]}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <AppBadge label={bn ? pr.bn : pr.en} tone={pr.tone} />
                  {c.is_vip ? <AppBadge label="VIP" tone="warning" /> : null}
                  {c.is_family ? <AppBadge label={bn ? 'পরিবার' : 'Family'} tone="success" /> : null}
                  {c.is_blocked ? <AppBadge label={bn ? 'ব্লক' : 'Blocked'} tone="danger" /> : null}
                  {c.category === 'spam' ? <AppBadge label={bn ? 'স্প্যাম' : 'Spam'} tone="warning" /> : null}
                  <AppBadge label={c.mode === 'auto' ? (bn ? 'অটো উত্তর' : 'Auto-reply') : c.mode === 'telegram' ? (bn ? 'বটে অনুমোদন' : 'Bot approval') : (bn ? 'ম্যানুয়াল উত্তর' : 'Manual reply')} tone={c.mode === 'auto' ? 'primary' : 'neutral'} />
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'এই চ্যাটের নিয়ম ও সেটিংস' : 'Chat rules and settings'}
                onPress={() => setShowRules((v) => !v)}
                style={{ minHeight: 38, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: showRules ? colors.primary : colors.border, backgroundColor: showRules ? colors.primaryTint : colors.surface, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: showRules ? colors.primary : colors.textPrimary }}>
                  {bn ? `⚙ নিয়ম ${showRules ? '▴' : '▾'}` : `⚙ Rules ${showRules ? '▴' : '▾'}`}
                </Text>
              </Pressable>
            </View>
            {c.need ? <Text style={{ marginTop: 6, fontSize: 13 }} numberOfLines={showRules ? undefined : 2}>{bn ? 'কী চান: ' : 'Needs: '}{c.need}</Text> : null}
            {showRules ? (
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                {c.summary ? <Text style={{ marginBottom: 6, opacity: 0.8 }}>{c.summary}</Text> : null}
                {replyExplain ? <Text style={{ marginBottom: 8, fontSize: 12, lineHeight: 18, opacity: 0.85 }}>{replyExplain}</Text> : null}
                <ChipGroup<Contact['mode']>
                  label={bn ? 'এই চ্যাটে সহকারী কীভাবে কাজ করবে (১ ট্যাপে বেছে নিন)' : 'How the assistant handles this chat'}
                  options={['auto', 'draft', 'telegram', 'notify', 'inherit']}
                  value={c.mode}
                  labelOf={(m) => m === 'auto' ? (bn ? 'অটো উত্তর' : 'Auto-reply') : m === 'draft' ? (bn ? 'শুধু খসড়া' : 'Draft only') : m === 'telegram' ? (bn ? 'বটে অনুমোদন' : 'Bot approval') : m === 'notify' ? (bn ? 'শুধু জানাবে' : 'Notify only') : (bn ? 'সাধারণ নিয়ম' : 'App default')}
                  onChange={(m) => {
                    if (!m || busy) return;
                    if (m === 'auto' && c.is_family) {
                      showSnackbar(bn ? 'পরিবারের চ্যাটে নিরাপত্তার কারণে অটো উত্তর বন্ধ থাকে' : 'Family chats never auto-reply', 'info');
                      return;
                    }
                    const promote = (m === 'auto' || m === 'draft' || m === 'telegram') && !c.is_family && (c.category === 'personal' || c.category === 'spam');
                    void act(
                      () => va.patchContact(c.id, { mode: m, ...(promote ? { category: 'business' } : {}) }),
                      m === 'auto' ? (bn ? '✓ এই চ্যাটে AI ও অটো উত্তর চালু হয়েছে' : '✓ AI & auto-reply enabled')
                        : m === 'draft' ? (bn ? '✓ সহকারী খসড়া লিখে রাখবে, আপনি পাঠাবেন' : '✓ Draft mode enabled')
                        : m === 'telegram' ? (bn ? '✓ খসড়া আপনার Telegram বটে যাবে' : '✓ Telegram bot approval enabled')
                        : (bn ? 'নিয়ম সংরক্ষণ হয়েছে' : 'Rule saved')
                    );
                  }}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      variant={c.category === 'business' || c.category === 'social' ? 'primary' : 'secondary'}
                      icon="brain"
                      label={c.is_family ? (bn ? 'পরিবার (অটো বন্ধ · খসড়া চালু)' : 'Family (auto off · drafts on)') : c.category === 'personal' ? (bn ? 'AI অটো-পড়া চালু করুন' : 'Enable AI auto-read') : (bn ? 'AI অটো-পড়া: চালু ✓' : 'AI auto-read: On ✓')}
                      disabled={busy || c.is_family}
                      onPress={() => void act(
                        () => va.patchContact(c.id, { category: c.category === 'personal' ? 'business' : 'personal', ...(c.category !== 'personal' && c.mode === 'auto' ? { mode: 'draft' } : {}) }),
                        c.category === 'personal' ? (bn ? '✓ এই চ্যাটে AI পড়া ও খসড়া চালু হয়েছে' : '✓ AI reading & drafts enabled') : (bn ? 'ব্যক্তিগত মোড: অটো উত্তর বন্ধ (নিচের বোতামে খসড়া পাবেন)' : 'Personal mode: auto-reply off (draft button still works)')
                      )}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      variant="secondary"
                      icon={c.category === 'spam' ? 'inbox-arrow-down-outline' : 'alert-octagon-outline'}
                      label={c.category === 'spam' ? (bn ? 'স্প্যাম সরান' : 'Not spam') : (bn ? 'স্প্যাম করুন' : 'Mark spam')}
                      disabled={busy || c.is_family}
                      onPress={() => void act(() => va.patchContact(c.id, { category: c.category === 'spam' ? null : 'spam' }), c.category === 'spam' ? (bn ? 'ইনবক্সে ফিরিয়ে আনা হয়েছে' : 'Moved back to inbox') : (bn ? 'স্প্যাম হিসেবে চিহ্নিত হয়েছে' : 'Marked as spam'))}
                    />
                  </View>
                </View>
                {c.is_family ? <Text style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>{bn ? 'পরিবারের চ্যাটে অটো উত্তর সবসময় বন্ধ থাকে; তবে নিচের “সহকারী লিখে দিক” চেপে যেকোনো সময় খসড়া লিখিয়ে নিতে পারবেন।' : 'Auto-reply stays off for family chats, but you can tap “Let it write” below anytime for a draft.'}</Text> : null}
                <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', opacity: 0.85 }}>{bn ? 'নোটিফিকেশন না থাকলে উত্তর পাঠানোর উপায় (একাধিক বেছে নিতে পারেন)' : 'Reply options when notification is gone (pick one or more)'}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {FALLBACK_OPTIONS.map((opt) => {
                      const on = fallbacks.includes(opt.key);
                      return (
                        <Pressable key={opt.key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggleFallback(opt.key)}
                          style={{ minHeight: 38, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface, justifyContent: 'center' }}>
                          <Text style={{ fontSize: 12, fontWeight: on ? '700' : '500', color: on ? colors.primary : colors.textPrimary }}>{on ? '✓ ' : ''}{bn ? opt.bn : opt.en}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {fallbacks.includes('auto') && !a11yOn ? (
                    <View style={{ marginTop: 4 }}>
                      <AppButton variant="secondary" icon="cog-outline" label={bn ? 'অটো-Send চালু করতে Accessibility সেটিং খুলুন' : 'Open Accessibility settings for Auto-Send'} onPress={() => { openAccessibilitySettings(); }} />
                    </View>
                  ) : null}
                  {fallbacks.includes('sms') && !smsNumber ? (
                    <Text style={{ fontSize: 11, opacity: 0.7 }}>{bn ? 'এই মানুষের ফোন নম্বর কনট্যাক্টসে মিললে SMS বোতাম সক্রিয় হবে।' : 'SMS button activates when a phone number is found in Contacts.'}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </Card>

          {drafts.map((d) => (
            <View
              key={d.id}
              style={{
                padding: 12,
                borderRadius: 18,
                borderWidth: 1.5,
                borderColor: colors.primary,
                backgroundColor: colors.surface,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>
                  {bn ? '✨ AI কো-পাইলট খসড়া উত্তর' : '✨ AI Co-Pilot Draft'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {DRAFT_TONES.map((t) => (
                    <Pressable
                      key={t.key}
                      accessibilityRole="button"
                      onPress={() => writeDraft({ tone: t.key })}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                        backgroundColor: draftMeta?.tone === t.key ? colors.primary : colors.surfaceMuted,
                      }}
                    >
                      <Text style={{ fontSize: 10.5, fontWeight: '700', color: draftMeta?.tone === t.key ? colors.onPrimary : colors.textPrimary }}>
                        {bn ? t.bn : t.en}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={{ padding: 10, borderRadius: 12, backgroundColor: colors.surfaceMuted }}>
                <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.textPrimary }}>“{d.body}”</Text>
              </View>
              {d.note ? <Text style={{ opacity: 0.75, fontSize: 11.5 }}>{bn ? 'কারণ: ' : 'Why: '}{d.note}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <AppButton label={bn ? '➤ এটাই পাঠান' : '➤ Send this'} icon="send" loading={busy} onPress={() => void act(() => va.approve(d.id), bn ? '✓ খসড়া উত্তর পাঠানো হয়েছে' : '✓ Draft sent')} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton variant="secondary" icon="refresh" label={bn ? 'আরেকটি লিখুন' : 'Write another'} disabled={busy} onPress={() => writeDraft({ another: true })} />
                </View>
              </View>
              <AppButton variant="secondary" label={bn ? 'বাদ দিন' : 'Discard'} disabled={busy} onPress={() => void act(() => va.discard(d.id))} />
            </View>
          ))}

          <View style={{ gap: 14 }}>
            {detail.data!.messages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                onRetryApp={fallbacks.includes('app') && chatPkg ? (t) => sendViaOpenApp(t) : undefined}
                onRetrySms={fallbacks.includes('sms') && smsNumber ? (t) => sendViaSms(t) : undefined}
                onRetryAuto={fallbacks.includes('auto') && chatPkg ? (t) => sendViaAutoClick(t) : undefined}
              />
            ))}
          </View>


          <Card>
            <Text style={{ opacity: 0.75, marginBottom: 8 }}>{bn ? 'WhatsApp বা অন্য অ্যাপে নিজে উত্তর দিয়ে থাকলে চাপুন, সহকারী তখন আর উত্তর দেবে না।' : 'Answered in the chat app yourself? Tap, and the assistant will not answer again.'}</Text>
            <AppButton variant="secondary" icon="check-circle-outline" label={bn ? 'আমি নিজে উত্তর দিয়েছি' : 'I answered myself'} loading={busy}
              onPress={() => void act(() => va.sentByHand(c.id, text.trim() || (bn ? '(নিজে উত্তর দিয়েছি)' : '(I answered myself)')), bn ? 'লিখে রাখা হলো। সহকারী কিছুক্ষণ চুপ থাকবে' : 'Noted. The assistant will stay quiet for a while')} />
          </Card>

          <AppButton variant="secondary" icon={more ? 'chevron-up' : 'chevron-down'} label={more ? (bn ? 'তথ্য ও নিয়ম লুকান' : 'Hide details and rules') : (bn ? 'এই মানুষের তথ্য ও নিয়ম' : 'This person’s details and rules')} onPress={() => setMore((v) => !v)} />
          {more ? (<>
          <Card title={bn ? 'ইনি কেমন মানুষ?' : 'What kind of person is this?'}>
            <Text style={{ opacity: 0.75, marginBottom: 6 }}>{c.category ? (bn ? CATEGORY[c.category].hintBn : CATEGORY[c.category].hintEn) : (bn ? 'সহকারী বার্তা পড়ে নিজে ঠিক করবে। আপনি বদলাতে পারেন।' : 'The assistant decides from the messages. You can change it.')}</Text>
            <ChipGroup<(typeof CATEGORY_KEYS)[number]> options={CATEGORY_KEYS} value={c.category} labelOf={(k) => (bn ? CATEGORY[k].bn : CATEGORY[k].en)} onChange={(k) => { if (k) void act(() => va.patchContact(c.id, { category: k })); }} />
          </Card>

          <Card title={bn ? 'এই মানুষটির নিয়ম' : 'Rules for this person'}>
            <ToggleRow icon="account-heart-outline" label={bn ? 'পরিবার' : 'Family'} hint={bn ? 'পরিবারকে কখনও নিজে উত্তর দেওয়া হয় না, শুধু আপনাকে জানানো হয়।' : 'Family never gets auto-replies; you are only notified.'}
              value={c.is_family} onChange={(v) => void act(() => va.patchContact(c.id, { is_family: v }))} />
            <ToggleRow icon="star-outline" label="VIP" value={c.is_vip} onChange={(v) => void act(() => va.patchContact(c.id, { is_vip: v }))} />
            <ToggleRow icon="block-helper" label={bn ? 'ব্লক' : 'Block'} value={c.is_blocked} onChange={(v) => void act(() => va.patchContact(c.id, { is_blocked: v }))} />
            <ChipGroup<Contact['mode']> label={bn ? 'উত্তরের ধরন' : 'Reply style'} options={MODES} value={c.mode} labelOf={(m) => (bn ? MODE[m]?.bn : MODE[m]?.en) ?? m}
              hint={bn ? '“নিজে উত্তর”: সহকারী এই মানুষকে নিজেই উত্তর দেবে। “Telegram-এ অনুমোদন”: প্রতিটি বার্তা খসড়াসহ আপনার Telegram বটে যাবে, সেখানে “পাঠান” চাপুন বা Reply-তে নিজে লিখুন। “শুধু খসড়া”: আপনি অ্যাপে দেখে পাঠাবেন। পরিবার ও ব্যক্তিগত মানুষকে কখনও নিজে উত্তর যায় না।' : '“Auto-reply”: the assistant answers this person itself. “Approve in Telegram”: each message comes to your Telegram bot with a draft; tap Send or reply there. “Drafts only”: you send from the app. Family and personal people never get auto-replies.'}
              onChange={(m) => { if (m) void act(() => va.patchContact(c.id, { mode: m })); }} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {c.state !== 'owner' ? <AppButton variant="secondary" label={bn ? 'আমি নিজে দেখব (সহকারী চুপ থাকবে)' : "I'll handle it (assistant stays quiet)"} onPress={() => void act(() => va.patchContact(c.id, { state: 'owner' }))} /> : null}
              {c.state !== 'done' ? <AppButton variant="secondary" label={bn ? 'কাজ শেষ' : 'Done'} onPress={() => void act(() => va.patchContact(c.id, { state: 'done' }))} /> : null}
              {c.state !== 'assistant' ? <AppButton variant="secondary" label={bn ? 'আবার সহকারীকে দিন' : 'Hand back to the assistant'} onPress={() => void act(() => va.patchContact(c.id, { state: 'assistant' }))} /> : null}
            </View>
          </Card>
          <Card title={bn ? 'অন্য নাম / ডাকনাম' : 'Other names'}>
            <Text style={{ opacity: 0.75, marginBottom: 6 }}>{bn ? 'এই মানুষকে আপনি আর কী নামে চেনেন? (যেমন Rahim, বড় ভাই)। একই মানুষ কি না মেলাতে এটা সহকারীকে সাহায্য করে। কমা দিয়ে লিখুন।' : 'Other names you know this person by (e.g. Rahim). Helps the assistant spot the same person. Separate with commas.'}</Text>
            <Field label="" value={aliasText || (aliases.data?.aliases ?? []).join(', ')} onChangeText={setAliasText} placeholder={bn ? 'যেমন: Rahim, বড় ভাই' : 'e.g. Rahim, Boro Vai'} />
            <View style={{ marginTop: 8 }}>
              <AppButton variant="secondary" label={bn ? 'সংরক্ষণ' : 'Save'} disabled={!aliasText.trim() && !(aliases.data?.aliases ?? []).length}
                onPress={() => void act(async () => { await va.setAliases(c.id, aliasText.split(',').map((x) => x.trim()).filter(Boolean)); setAliasText(''); await aliases.reload(); }, bn ? 'সংরক্ষণ হয়েছে' : 'Saved')} />
            </View>
          </Card>
          <ContactMemory contactId={c.id} />
          <TagEditor tags={c.tags ?? []} onSave={(tags) => act(() => va.patchContact(c.id, { tags }))} />

          <ChatTransfer contactId={c.id} isPrivate={c.is_family || c.category === 'personal'} onLearned={() => void detail.reload()} />

          <HistoryImport contactId={c.id} isPrivate={c.is_family || c.category === 'personal'} />

          </>) : null}
        </>
      ) : null}
    </Page>
  );
}
