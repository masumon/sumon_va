import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, Field, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { radius, spacing, typography } from '../src/theme';
import { va, errTone, type F0Result } from '../src/va/api';
import { Page } from '../src/va/Page';
import { CHANNEL, MESSAGE_STATUS } from '../src/va/labels';

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
const QUICK = [
  { bn: 'মিসড কল', en: 'Missed calls', cmd: 'মিসড কল' }, { bn: 'কার উত্তর বাকি', en: 'Who is waiting', cmd: 'কার উত্তর বাকি' }, { bn: 'আমার কাজ', en: 'My tasks', cmd: 'আমার কাজ' },
  { bn: 'জরুরি', en: 'Urgent', cmd: 'জরুরি' }, { bn: 'খসড়া', en: 'Drafts', cmd: 'খসড়া' }, { bn: 'কী পাঠানো হলো', en: 'What was sent', cmd: 'কী কী পাঠানো হয়েছে' },
  { bn: 'সহকারীর অবস্থা', en: 'Assistant status', cmd: 'সহকারীর অবস্থা' }, { bn: 'নিয়ম', en: 'Rules', cmd: 'নিয়ম' },
] as const;

export default function F0Screen() {
  const { bn, colors } = useKit();
  const router = useRouter();
  const { showSnackbar } = useAppFeedback();
  const [text, setText] = useState('');
  const [asked, setAsked] = useState('');
  const [res, setRes] = useState<F0Result | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [past, setPast] = useState<{ q: string; a: string }[]>([]); // earlier questions and answers, newest last (this visit only)

  const send = async (cmd: string) => {
    setBusy(true); setResult(null);
    try {
      const r = await va.f0Command(cmd);
      if (res?.answer && asked) setPast((p) => [...p.slice(-5), { q: asked, a: res.answer }]);
      setRes(r); setBody(r.draft?.body ?? ''); setText('');
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
            style={{ minHeight: 48, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
            <Text style={{ ...typography.callout, color: colors.textPrimary }}>{bn ? q.bn : q.en}</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <Field label="" value={text} onChangeText={setText} multiline placeholder={bn ? 'যেমন: রহিমকে বলো কাল আসছি' : 'e.g. tell Rahim I am coming tomorrow'}
          hint={bn ? 'মুখে বলতে চাইলে কিবোর্ডের মাইক চাপুন।' : 'To speak, use the microphone on your keyboard.'} />
        <View style={{ marginTop: spacing.sm }}>
          <AppButton label={bn ? 'বলুন' : 'Ask'} icon="send" loading={busy && !d} disabled={!text.trim() || busy}
            onPress={() => { const t = text.trim(); setAsked(t); void send(t); }} />
        </View>
      </Card>

      {past.map((p, i) => (
        <View key={i} style={{ gap: spacing.xs, opacity: 0.8 }}>
          <Text style={{ ...typography.caption, color: colors.textMuted, textAlign: 'right' }}>{p.q}</Text>
          <Text style={{ ...typography.callout, color: colors.textPrimary }}>{p.a}</Text>
        </View>
      ))}
      {res && asked ? <Text style={{ ...typography.callout, color: colors.textMuted, textAlign: 'right' }}>{bn ? 'আপনি: ' : 'You: '}{asked}</Text> : null}
      {res ? (
        <Card title={bn ? 'সহকারী' : 'Assistant'}>
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
