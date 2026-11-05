import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text, AppTextInput } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { Card, ChipGroup, EmptyNote, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { formatBangladeshDateTime, formatBangladeshNumber } from '../src/i18n/date-time';
import { va, VaError, type HubConn } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';

const PROVIDERS = ['auto', 'gemini', 'groq', 'openrouter', 'openai', 'deepseek', 'mistral', 'nvidia', 'cloudflare'] as const;
const CAPS = ['0', '20', '50', '100', '300'] as const;
const STATUS: Record<HubConn['status'], { bn: string; en: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ok: { bn: 'চলছে ✓', en: 'Working ✓', tone: 'success' }, limit: { bn: 'আজকের সীমা শেষ', en: 'Limit reached', tone: 'warning' },
  bad: { bn: 'চলছে না', en: 'Not working', tone: 'danger' }, error: { bn: 'ত্রুটি', en: 'Error', tone: 'danger' }, new: { bn: 'পরীক্ষা বাকি', en: 'Not tested', tone: 'neutral' },
};

/** AI connections, as in the admin: add keys, test them, set the order (free before paid), and try a real answer. */
export default function AiScreen() {
  const { bn, language, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const hub = useLoad(() => va.aiHub(), 'ai-hub', 60000);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('auto');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ text: string; provider?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drop, setDrop] = useState<HubConn | null>(null);
  const h = hub.data;

  const [slow, setSlow] = useState(false);
  const act = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id);
    // Testing an AI asks an outside company and can take a while: say so, instead of looking stuck or failed.
    const timer = setTimeout(() => setSlow(true), 6000);
    try { await fn(); await hub.reload(); if (ok) showSnackbar(ok, 'success'); }
    catch (e) {
      // A slow answer is not a failure and no internet is not a server fault: each gets its own honest message.
      const kind = e instanceof VaError ? e.kind : 'other';
      showSnackbar(e instanceof Error ? e.message : '', kind === 'timeout' ? 'info' : 'danger');
    }
    finally { clearTimeout(timer); setSlow(false); setBusy(null); }
  };

  return (
    <Page title={bn ? 'AI সংযোগ' : 'AI connections'} subtitle={bn ? 'সব AI কী এক জায়গায়। আগে ফ্রি, পরে পেইড' : 'All AI keys in one place — free first, paid after'} onRefresh={hub.reload} refreshing={hub.loading && !!h}>
      <Status loading={hub.loading && !h} error={h ? null : hub.error} onRetry={hub.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {busy && slow ? <Text style={{ opacity: 0.8, textAlign: 'center' }}>{bn ? 'সময় লাগছে, একটু অপেক্ষা করুন…' : 'Taking a while, please wait…'}</Text> : null}
      {h ? (
        <>
          <Hero icon="brain" title={h.working ? (bn ? `${h.working}টি AI চলছে ✓` : `${h.working} AI working ✓`) : (bn ? 'কোনো AI চলছে না' : 'No AI working')} subtitle={bn ? 'সহকারী, অনুবাদ ও লেখায় এগুলোই কাজ করে' : 'The assistant, translation and writing use these'}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <HeroStat value={formatBangladeshNumber(h.today.count, language)} label={bn ? 'আজকের ব্যবহার' : 'Used today'} />
              <HeroStat value={formatBangladeshNumber(h.today.paid, language)} label={bn ? 'পেইড ব্যবহার' : 'Paid use'} />
              <HeroStat value={formatBangladeshNumber(h.connections.length, language)} label={bn ? 'সংযোগ' : 'Connections'} />
            </View>
          </Hero>
          {h.last_error?.text ? <Card title={bn ? 'শেষ সমস্যা' : 'Last problem'}><Text style={{ opacity: 0.85 }}>{h.last_error.text}</Text></Card> : null}

          {h.connections.length === 0 ? <EmptyNote icon="key-outline" text={bn ? 'এখনও কোনো AI কী নেই। নিচে যোগ করুন। Gemini বা Groq-এর ফ্রি কী দিয়ে শুরু করতে পারেন।' : 'No AI key yet. Add one below (a free Gemini or Groq key is a good start).'} /> : null}
          {h.connections.map((c, i) => {
            const st = STATUS[c.status];
            return (
              <Card key={c.id} title={`${i + 1}. ${c.label || c.provider}`}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <AppBadge tone={st.tone} label={bn ? st.bn : st.en} />
                  <AppBadge tone={c.tier === 'free' ? 'success' : 'warning'} label={c.tier === 'free' ? (bn ? 'ফ্রি' : 'Free') : (bn ? 'পেইড' : 'Paid')} />
                  <AppBadge tone="neutral" label={bn ? `আজ ${c.used_today}টি` : `${c.used_today} today`} />
                </View>
                <Text style={{ opacity: 0.7, fontSize: 12 }}>{c.hint}{c.checked_at ? ` · ${bn ? 'পরীক্ষা' : 'tested'} ${formatBangladeshDateTime(c.checked_at, language)}` : ''}</Text>
                {c.note ? <Text style={{ color: st.tone === 'danger' ? colors.danger : st.tone === 'success' ? colors.success : st.tone === 'warning' ? colors.warning : colors.textMuted, fontSize: 12, marginTop: 4 }}>{c.note}</Text> : null}
                <ToggleRow label={bn ? 'চালু' : 'Enabled'} value={c.enabled} onChange={(v) => void act(c.id, () => va.aiPatch(c.id, { enabled: v }))} />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <AppButton variant="secondary" label={bn ? 'পরীক্ষা' : 'Test'} icon="flash-outline" loading={busy === c.id} onPress={() => void act(c.id, () => va.aiTest(c.id), bn ? 'পরীক্ষা হয়েছে' : 'Tested')} />
                  <AppButton variant="secondary" label="↑" disabled={i === 0} onPress={() => void act(c.id, () => va.aiPatch(c.id, { move: -1 }))} />
                  <AppButton variant="secondary" label="↓" disabled={i === h.connections.length - 1} onPress={() => void act(c.id, () => va.aiPatch(c.id, { move: 1 }))} />
                  <AppButton variant="secondary" label={c.tier === 'free' ? (bn ? 'পেইড হিসেবে রাখুন' : 'Mark paid') : (bn ? 'ফ্রি হিসেবে রাখুন' : 'Mark free')} onPress={() => void act(c.id, () => va.aiPatch(c.id, { tier: c.tier === 'free' ? 'paid' : 'free' }))} />
                  <AppButton variant="danger" label={bn ? 'মুছুন' : 'Remove'} onPress={() => setDrop(c)} />
                </View>
              </Card>
            );
          })}
          {h.connections.length > 0 ? <AppButton variant="secondary" icon="flash" label={bn ? 'সবগুলো একসাথে পরীক্ষা' : 'Test all'} loading={busy === 'all'} onPress={() => void act('all', () => va.aiTestAll(), bn ? 'সব পরীক্ষা হয়েছে' : 'All tested')} /> : null}

          <Card title={bn ? 'নতুন AI কী যোগ করুন' : 'Add an AI key'}>
            <ChipGroup<(typeof PROVIDERS)[number]> label={bn ? 'কোন সেবা (না জানলে “auto”)' : 'Provider (“auto” if unsure)'} options={PROVIDERS} value={provider} labelOf={(p) => p} onChange={(p) => { if (p) setProvider(p); }} />
            <Text style={{ marginTop: 8, marginBottom: 4, fontSize: 12, opacity: 0.7 }}>{bn ? 'কী (গোপন, দেখা যাবে না)' : 'Key (secret — hidden)'}</Text>
            <AppTextInput value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="sk-… / AIza…" style={{ minHeight: 50, borderWidth: 1, borderColor: '#8884', borderRadius: 12, paddingHorizontal: 12 }} />
            <Field label={bn ? 'নাম (ঐচ্ছিক)' : 'Name (optional)'} value={label} onChangeText={setLabel} />
            <View style={{ marginTop: 10 }}><AppButton label={bn ? 'যোগ করুন ও পরীক্ষা করুন' : 'Add and test'} icon="plus" loading={busy === 'add'} disabled={key.trim().length < 8} onPress={() => void act('add', async () => { await va.aiAdd({ key: key.trim(), provider, label: label.trim() }); setKey(''); setLabel(''); }, bn ? 'যোগ হয়েছে' : 'Added')} /></View>
          </Card>

          <Card title={bn ? 'পেইড AI-এর নিয়ম' : 'Paid AI rule'}>
            <ToggleRow label={bn ? 'ফ্রি শেষ হলে পেইড ব্যবহার করবে' : 'Use paid when free runs out'} hint={bn ? 'বন্ধ থাকলে শুধু ফ্রি AI চলবে।' : 'Off = free AI only.'} value={h.prefs.allow_paid} onChange={(v) => void act('prefs', () => va.aiPrefs({ allow_paid: v }))} />
            {h.prefs.allow_paid ? <ChipGroup<(typeof CAPS)[number]> label={bn ? 'দিনে সর্বোচ্চ পেইড ব্যবহার' : 'Paid cap per day'} options={CAPS} value={String(h.prefs.paid_daily_cap) as (typeof CAPS)[number]} labelOf={(c) => c} onChange={(c) => { if (c) void act('prefs', () => va.aiPrefs({ paid_daily_cap: Number(c) })); }} /> : null}
          </Card>

          <Card title={bn ? 'এখনই চেষ্টা করে দেখুন' : 'Try it now'}>
            <Field label="" value={question} onChangeText={setQuestion} placeholder={bn ? 'কিছু জিজ্ঞেস করুন (খালি রাখলে একটা নমুনা প্রশ্ন যাবে)' : 'Ask something (empty = sample)'} />
            <View style={{ marginTop: 8 }}><AppButton variant="secondary" icon="send" label={bn ? 'উত্তর দেখি' : 'Show answer'} loading={busy === 'try'} onPress={() => void act('try', async () => setAnswer(await va.aiTry('chat', question)))} /></View>
            {answer ? <View style={{ marginTop: 10 }}><Text style={{ lineHeight: 22 }}>{answer.text}</Text>{answer.provider ? <Text style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>{bn ? 'উত্তর দিয়েছে: ' : 'Answered by: '}{answer.provider}</Text> : null}</View> : null}
          </Card>
        </>
      ) : null}
      <AppConfirmDialog visible={!!drop} danger icon="trash-can-outline" title={bn ? 'এই সংযোগ সরাবেন?' : 'Remove this connection?'} description={drop ? `${drop.label || drop.provider}` : ''}
        cancelLabel={bn ? 'না' : 'No'} confirmLabel={bn ? 'সরান' : 'Remove'} onCancel={() => setDrop(null)} onConfirm={() => { const c = drop; setDrop(null); if (c) void act(c.id, () => va.aiRemove(c.id), bn ? 'সরানো হয়েছে' : 'Removed'); }} />
    </Page>
  );
}
