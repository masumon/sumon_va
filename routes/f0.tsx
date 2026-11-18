import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon, type IconName } from '../src/ui/AppIcon';
import { Card, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { radius, spacing, typography } from '../src/theme';
import { va, errTone, type F0Result } from '../src/va/api';
import { Page } from '../src/va/Page';
import { useAppActive, useLoad } from '../src/va/hooks';
import { CHANNEL, MESSAGE_STATUS } from '../src/va/labels';
import { readMediaUri, readSharedMedia, type SharedMediaResult } from '../modules/va-bridge';

/**
 * What really happened to the message, read from its own stored status (the same labels the inbox uses). The server's free-text
 * `message` is deliberately not shown: for a message only handed to the phone ("sending") it still says "sent". Failure is flagged.
 */
function outcome(r: unknown, bn: boolean): { text: string; ok: boolean } | null {
  const m = r && typeof r === 'object' ? (r as { status?: string; error?: string | null }) : {};
  const label = m.status ? MESSAGE_STATUS[m.status as keyof typeof MESSAGE_STATUS] : undefined;
  if (!label) return null;
  const text = bn ? label.bn : label.en;
  const failed = m.status === 'failed' || m.status === 'skipped';
  return { text: failed && m.error ? `${text}: ${m.error}` : text, ok: !failed };
}

/** Tell the assistant in words: ask about people, tasks, missed calls, or have it draft a reply. Voice = the keyboard's own mic. */
const QUICK: readonly { bn: string; en: string; cmd: string; icon: IconName }[] = [
  { bn: 'মিসড কল', en: 'Missed calls', cmd: 'মিসড কল', icon: 'phone-missed' },
  { bn: 'কার উত্তর বাকি', en: 'Who is waiting', cmd: 'কার উত্তর বাকি', icon: 'message-reply-text-outline' },
  { bn: 'আমার কাজ', en: 'My tasks', cmd: 'আমার কাজ', icon: 'checkbox-marked-circle-outline' },
  { bn: 'জরুরি', en: 'Urgent', cmd: 'জরুরি', icon: 'alert-octagon-outline' },
  { bn: 'খসড়া', en: 'Drafts', cmd: 'খসড়া', icon: 'file-document-edit-outline' },
  { bn: 'কী পাঠানো হলো', en: 'What was sent', cmd: 'কী কী পাঠানো হয়েছে', icon: 'send-check-outline' },
  { bn: 'সহকারীর অবস্থা', en: 'Assistant status', cmd: 'সহকারীর অবস্থা', icon: 'robot-outline' },
  { bn: 'নিয়ম', en: 'Rules', cmd: 'নিয়ম', icon: 'shield-check-outline' },
];

export default function F0Screen() {
  const { bn, colors } = useKit();
  const router = useRouter();
  const params = useLocalSearchParams<{ cmd?: string }>();
  const { showSnackbar } = useAppFeedback();
  const [text, setText] = useState(params.cmd ?? '');
  const [cmdSeen, setCmdSeen] = useState(params.cmd);
  if (params.cmd !== cmdSeen) { setCmdSeen(params.cmd); if (params.cmd) setText(params.cmd); }
  const [asked, setAsked] = useState('');
  const [res, setRes] = useState<F0Result | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const auto = !!cfg.data?.config.f0?.auto_send;
  const setAuto = async (v: boolean) => {
    try { await va.saveAssistantConfig({ f0: { auto_send: v } }); await cfg.reload(); showSnackbar(v ? (bn ? 'অটো: বললেই বার্তা চলে যাবে' : 'Auto: messages go at once') : (bn ? 'ম্যানুয়াল: পাঠানোর আগে দেখাবে' : 'Manual: you check before it goes'), 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  const [past, setPast] = useState<{ q: string; a: string }[]>([]); // earlier questions and answers, newest last (this visit only)
  const appActive = useAppActive();

  const handleMedia = useCallback(async (m: SharedMediaResult, label: string) => {
    if (!m.ok || !m.dataB64 || !m.mime) {
      showSnackbar(m.error || (bn ? 'ফাইলটি পড়া যায়নি' : 'Could not read file'), 'danger');
      return;
    }
    setBusy(true); setResult(null);
    setAsked(label);
    try {
      const r = await va.analyzeMedia(m.mime, m.dataB64, m.name ?? '');
      setRes({ intent: 'system', answer: r.summary, items: [], choices: [], draft: null });
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  }, [bn, showSnackbar]);

  useEffect(() => {
    if (!appActive) return;
    void readSharedMedia().then((m) => {
      if (m) void handleMedia(m, bn ? `শেয়ার করা ফাইল${m.name ? `: ${m.name}` : ''}` : `Shared file${m.name ? `: ${m.name}` : ''}`);
    });
  }, [appActive, bn, handleMedia]);

  const pickMedia = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'image/*'], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0]!;
      const m = await readMediaUri(asset.uri, asset.mimeType ?? '');
      await handleMedia({ ...m, name: asset.name || m.name }, bn ? `ফাইল: ${asset.name || 'ভয়েস/ছবি'}` : `File: ${asset.name || 'audio/image'}`);
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };

  const send = async (cmd: string) => {
    setBusy(true); setResult(null);
    try {
      const r = await va.f0Command(cmd);
      if (res?.answer && asked) setPast((p) => [...p.slice(-5), { q: asked, a: res.answer }]);
      setRes(r); setBody(r.draft?.body ?? ''); setText('');
      if (r.sent) setResult(outcome(r.sent, bn));
    } catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!res?.draft) return;
    const d = res.draft;
    setBusy(true);
    try {
      const edited = body.trim() !== d.body.trim() ? body.trim() : undefined;
      const r = await va.approve(d.id, edited);
      setResult(outcome(r, bn) ?? { text: bn ? 'পাঠানোর জন্য দেওয়া হয়েছে। পৌঁছাল কি না ইনবক্সে ওই মানুষের পাতায় দেখা যাবে।' : 'Handed over for sending. See in the inbox whether it arrived.', ok: true });
      setRes({ ...res, draft: null });
    } catch (e) { setResult({ text: e instanceof Error ? e.message : '', ok: false }); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (!res?.draft) return;
    setBusy(true);
    try {
      const r = await va.discard(res.draft.id);
      setResult(outcome(r, bn) ?? { text: bn ? 'ঠিক আছে, বার্তাটা পাঠানো হবে না।' : 'OK, the message will not be sent.', ok: true });
      setRes({ ...res, draft: null });
    } catch (e) { setResult({ text: e instanceof Error ? e.message : '', ok: false }); }
    finally { setBusy(false); }
  };

  const openContact = (id: string) => router.push({ pathname: '/contact', params: { id } } as never);
  const d = res?.draft ?? null;

  return (
    <Page title={bn ? 'সহকারীকে বলুন' : 'Tell the assistant'} subtitle={bn ? 'যা জানতে চান বা যাকে যা বলতে চান, লিখুন' : 'Write what you want to know, or what to tell someone'}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {QUICK.map((q) => (
          <Pressable key={q.cmd} accessibilityRole="button" accessibilityLabel={bn ? q.bn : q.en} disabled={busy} onPress={() => { setText(q.cmd); setAsked(q.cmd); void send(q.cmd); }}
            style={({ pressed }) => ({
              minHeight: 48, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
              borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.75 : 1,
            })}>
            <AppIcon name={q.icon} size={18} color={colors.primary} />
            <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? q.bn : q.en}</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
          <AppBadge tone={auto ? 'warning' : 'success'} label={auto ? (bn ? 'অটো মোড: বললেই যাবে' : 'Auto: goes at once') : (bn ? 'নিরাপদ মোড: আগে দেখাবে' : 'Safe mode: previews first')} />
        </View>
        <ToggleRow icon="send-clock-outline" label={bn ? (auto ? 'পাঠানো: অটো' : 'পাঠানো: ম্যানুয়াল') : (auto ? 'Sending: auto' : 'Sending: manual')}
          hint={bn ? (auto ? 'কাউকে কিছু বলতে বললে সঙ্গে সঙ্গে চলে যায়। কোনো সন্দেহ থাকলে (কে, আগেই উত্তর দেওয়া, ২৪ ঘণ্টা পার) আগে দেখাবে।' : 'বার্তা আগে দেখাবে, আপনি “পাঠান” চাপলে যাবে।')
            : (auto ? 'A message you dictate goes at once. If anything is unclear it shows it to you first.' : 'Shows the message first; it goes when you tap Send.')}
          value={auto} onChange={(v) => void setAuto(v)} />
        <Field label="" value={text} onChangeText={setText} multiline placeholder={bn ? 'যেমন: রহিমকে বলো কাল আসছি · রহিম সম্পর্কে মনে রাখো... · কাজ যোগ করো...' : 'e.g. tell Rahim I am coming · remember about Rahim... · add task...'}
          hint={bn ? 'বাংলা, বাংলিশ বা ইংরেজিতে লিখুন; মুখে বলতে কিবোর্ডের মাইক চাপুন।' : 'Write in Bangla, Banglish or English; use keyboard mic to speak.'} />
        <View style={{ marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton label={bn ? 'বলুন' : 'Ask'} icon="send" loading={busy && !d} disabled={!text.trim() || busy}
              onPress={() => { const t = text.trim(); setAsked(t); void send(t); }} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton variant="secondary" label={bn ? 'ভয়েস / ছবি' : 'Voice / Photo'} icon="microphone-outline" disabled={busy}
              onPress={() => void pickMedia()} />
          </View>
        </View>
      </Card>

      {past.map((p, i) => (
        <View key={i} style={{ gap: spacing.xs }}>
          <View style={{ alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.card, backgroundColor: colors.primaryTint }}>
            <Text style={{ ...typography.callout, color: colors.textPrimary }}>{p.q}</Text>
          </View>
          <View style={{ alignSelf: 'flex-start', maxWidth: '92%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ ...typography.body, color: colors.textPrimary }}>{p.a}</Text>
          </View>
        </View>
      ))}
      {res && asked ? (
        <View style={{ alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.card, backgroundColor: colors.primaryTint }}>
          <Text style={{ ...typography.callout, color: colors.primary }}>{asked}</Text>
        </View>
      ) : null}
      {res ? (
        <Card icon="robot-happy-outline" title={bn ? 'সহকারীর উত্তর' : 'Assistant reply'}>
          {res.answer ? <Text>{res.answer}</Text> : null}
          {res.items.map((it, i) => (
            <Pressable key={i} accessibilityRole={it.contact_id ? 'button' : 'text'} accessibilityLabel={it.subtitle ? `${it.title}, ${it.subtitle}` : it.title}
              disabled={!it.contact_id} onPress={() => { if (it.contact_id) openContact(it.contact_id); }}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.callout, color: colors.textPrimary }}>{it.title}</Text>
                {it.subtitle ? <Text style={{ ...typography.caption, color: colors.textMuted }}>{it.subtitle}</Text> : null}
              </View>
              {it.contact_id ? <AppIcon name="chevron-right" size={22} color={colors.textMuted} /> : null}
            </Pressable>
          ))}
          {res.choices.length > 0 ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? 'কার কথা বলছেন? একজনকে বাছুন' : 'Who do you mean? Pick one'}</Text>
              {res.choices.map((c) => (
                <AppButton key={c.contact_id} variant="secondary" label={c.label} disabled={busy} onPress={() => void send(`${asked} #${c.contact_id}`)} />
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {d ? (
        <Card title={bn ? 'এই বার্তাটা যাবে (দেখে নিন)' : 'This message will be sent (check it)'}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? 'কাকে: ' : 'To: '}{d.to}</Text>
            <AppBadge label={(bn ? CHANNEL[d.channel as keyof typeof CHANNEL]?.bn : CHANNEL[d.channel as keyof typeof CHANNEL]?.en) ?? d.channel} tone="neutral" />
          </View>
          {d.warnings.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.smd, borderRadius: radius.card, backgroundColor: colors.surfaceMuted, marginBottom: spacing.sm }}>
              <AppIcon name="alert-outline" size={20} color={colors.warning} />
              <Text style={{ flex: 1, color: colors.textPrimary }}>{w}</Text>
            </View>
          ))}
          <Field label={bn ? 'বার্তা (বদলাতে পারেন)' : 'Message (you can edit)'} value={body} onChangeText={setBody} multiline />
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <AppButton label={bn ? 'পাঠান' : 'Send'} icon="send" loading={busy} disabled={!body.trim()} onPress={() => void approve()} />
            <AppButton variant="secondary" label={bn ? 'পাঠাবেন না' : 'Do not send'} disabled={busy} onPress={() => void discard()} />
          </View>
        </Card>
      ) : null}

      {result ? (
        <Card title={result.ok ? (bn ? 'কী হলো' : 'What happened') : (bn ? 'হয়নি' : 'Did not work')}>
          <Text style={{ color: result.ok ? colors.textPrimary : colors.danger }}>{result.text}</Text>
        </Card>
      ) : null}
    </Page>
  );
}
