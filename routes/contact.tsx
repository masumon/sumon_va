import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { va, type Contact, type Message } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { BrandLogo, brandFor, brandName } from '../src/va/BrandLogo';
import { TagEditor } from '../src/va/TagEditor';
import { ChatTransfer } from '../src/va/ChatTransfer';
import { ChatMenuButton } from '../src/va/ChatMenu';
import { AppIcon } from '../src/ui/AppIcon';
import { CATEGORY, CATEGORY_KEYS, CHANNEL, MESSAGE_STATUS, MODE, PRIORITY, displayName } from '../src/va/labels';

const MODES: Contact['mode'][] = ['inherit', 'auto', 'draft', 'notify'];

/** WhatsApp-style ticks for what we sent: clock = on its way, ✓ = left us, ✓✓ = reached their phone, blue ✓✓ = they read it, ! = failed. */
function Ticks({ m }: { m: Message }) {
  const { colors } = useKit();
  if (m.status === 'failed') return <AppIcon name="alert-circle-outline" size={15} color={colors.danger} />;
  if (m.status === 'queued' || m.status === 'sending' as string) return <AppIcon name="clock-outline" size={14} color={colors.textMuted} />;
  if (m.delivery === 'read') return <AppIcon name="check-all" size={16} color="#34B7F1" />;
  if (m.delivery === 'delivered') return <AppIcon name="check-all" size={16} color={colors.textMuted} />;
  if (m.status === 'sent') return <AppIcon name="check" size={16} color={colors.textMuted} />;
  return null;
}

function Bubble({ m }: { m: Message }) {
  const { colors, bn, language } = useKit();
  const mine = m.direction === 'out';
  const st = MESSAGE_STATUS[m.status];
  const text = m.transcript || m.body || (bn ? '(লেখা নেই)' : '(no text)');
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', gap: 4 }}>
      <View style={{ padding: 12, borderRadius: 16, backgroundColor: mine ? colors.primaryTint : colors.surfaceMuted }}>
        <Text style={{ color: colors.textPrimary, lineHeight: 22 }}>{text}</Text>
      </View>
      <Text style={{ color: m.status === 'failed' ? colors.danger : colors.textMuted, fontSize: 11, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
        {m.created_at ? formatBangladeshDateTime(m.created_at, language) : ''}{mine ? ` · ${bn ? (m.delivery === 'read' ? 'পড়েছেন' : m.delivery === 'delivered' ? 'পৌঁছেছে' : st.bn) : (m.delivery === 'read' ? 'Read' : m.delivery === 'delivered' ? 'Delivered' : st.en)}` : ''}{m.tag ? ` · ${m.tag}` : ''}{m.error ? ` · ${m.error}` : ''}
      </Text>
      {mine ? <View style={{ alignSelf: 'flex-end' }}><Ticks m={m} /></View> : null}
    </View>
  );
}

export default function ContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const detail = useLoad(() => va.contact(String(id)), `contact:${String(id)}`, 10000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await detail.reload(); if (ok) showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
    finally { setBusy(false); }
  };

  const c = detail.data?.contact;
  const drafts = (detail.data?.messages ?? []).filter((m) => m.status === 'draft');
  const pr = c ? (PRIORITY[c.priority] ?? PRIORITY[5]!) : null;

  return (
    <Page title={c ? displayName(c) : '…'} subtitle={c ? (bn ? CHANNEL[c.channel].bn : CHANNEL[c.channel].en) : undefined} back={bn ? 'ইনবক্স' : 'Inbox'} right={c ? <ChatMenuButton contact={c} onChanged={() => void detail.reload()} size={26} /> : null} onRefresh={detail.reload} refreshing={detail.loading && !!detail.data}>
      <Status loading={detail.loading && !detail.data} error={detail.data ? null : detail.error} onRetry={detail.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c && pr ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <BrandLogo brand={brandFor(c.channel, c.phone)} size={40} />
              <Text style={{ flex: 1, fontWeight: '700' }}>{bn ? 'এসেছে: ' : 'From: '}{brandName(brandFor(c.channel, c.phone))} · {c.phone.split(':').slice(-1)[0]}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <AppBadge label={bn ? pr.bn : pr.en} tone={pr.tone} />
              {c.is_family ? <AppBadge label={bn ? 'পরিবার' : 'Family'} tone="success" /> : null}
              {c.is_blocked ? <AppBadge label={bn ? 'ব্লক' : 'Blocked'} tone="danger" /> : null}
            </View>
            {c.need ? <Text style={{ marginTop: 8 }}>{bn ? 'কী চান: ' : 'Needs: '}{c.need}</Text> : null}
            {c.summary ? <Text style={{ marginTop: 4, opacity: 0.8 }}>{c.summary}</Text> : null}
          </Card>

          <View style={{ gap: 14 }}>{detail.data!.messages.map((m) => <Bubble key={m.id} m={m} />)}</View>

          {drafts.map((d) => (
            <Card key={d.id} title={bn ? 'সহকারীর খসড়া উত্তর' : "Assistant's draft reply"}>
              <Text style={{ marginBottom: 6 }}>{d.body}</Text>
              {d.note ? <Text style={{ opacity: 0.7, fontSize: 12, marginBottom: 10 }}>{bn ? 'কারণ: ' : 'Why: '}{d.note}</Text> : null}
              <View style={{ gap: 8 }}>
                <AppButton label={bn ? 'এটাই পাঠান' : 'Send this'} icon="send" loading={busy} onPress={() => void act(() => va.approve(d.id), bn ? 'পাঠানো হয়েছে' : 'Sent')} />
                <AppButton variant="secondary" label={bn ? 'বাদ দিন' : 'Discard'} onPress={() => void act(() => va.discard(d.id))} />
              </View>
            </Card>
          ))}

          <Card title={bn ? 'আপনার উত্তর' : 'Your reply'}>
            <Field label="" value={text} onChangeText={setText} multiline placeholder={bn ? 'এখানে লিখুন…' : 'Write here…'} />
            <View style={{ gap: 8, marginTop: 10 }}>
              <AppButton label={bn ? 'পাঠান' : 'Send'} icon="send" loading={busy} disabled={!text.trim()}
                onPress={() => void act(async () => { await va.reply(c.id, text.trim()); setText(''); }, bn ? 'পাঠানো হয়েছে' : 'Sent')} />
              <AppButton variant="secondary" icon="auto-fix" label={bn ? 'সহকারী লিখে দিক' : 'Let the assistant draft it'} loading={busy}
                onPress={() => void act(async () => { const r = await va.suggest(c.id); setText(r.text ?? r.reply ?? ''); })} />
            </View>
          </Card>

          <ChatTransfer contactId={c.id} isPrivate={c.is_family || c.category === 'personal'} onLearned={() => void detail.reload()} />

          <TagEditor tags={c.tags ?? []} onSave={(tags) => act(() => va.patchContact(c.id, { tags }))} />

          <Card title={bn ? 'ইনি কেমন মানুষ?' : 'What kind of person is this?'}>
            <Text style={{ opacity: 0.75, marginBottom: 6 }}>{c.category ? (bn ? CATEGORY[c.category].hintBn : CATEGORY[c.category].hintEn) : (bn ? 'সহকারী বার্তা পড়ে নিজে ঠিক করবে। আপনি বদলাতে পারেন।' : 'The assistant decides from the messages. You can change it.')}</Text>
            <ChipGroup<(typeof CATEGORY_KEYS)[number]> options={CATEGORY_KEYS} value={c.category} labelOf={(k) => (bn ? CATEGORY[k].bn : CATEGORY[k].en)} onChange={(k) => { if (k) void act(() => va.patchContact(c.id, { category: k })); }} />
          </Card>

          <Card title={bn ? 'এই মানুষটির নিয়ম' : 'Rules for this person'}>
            <ToggleRow icon="account-heart-outline" label={bn ? 'পরিবার' : 'Family'} hint={bn ? 'পরিবারকে কখনও নিজে উত্তর দেওয়া হয় না, শুধু আপনাকে জানানো হয়।' : 'Family never gets auto-replies; you are only notified.'}
              value={c.is_family} onChange={(v) => void act(() => va.patchContact(c.id, { is_family: v }))} />
            <ToggleRow icon="star-outline" label="VIP" value={c.is_vip} onChange={(v) => void act(() => va.patchContact(c.id, { is_vip: v }))} />
            <ToggleRow icon="block-helper" label={bn ? 'ব্লক' : 'Block'} value={c.is_blocked} onChange={(v) => void act(() => va.patchContact(c.id, { is_blocked: v }))} />
            <ChipGroup<Contact['mode']> label={bn ? 'উত্তরের ধরন' : 'Reply style'} options={MODES} value={c.mode} labelOf={(m) => (bn ? MODE[m].bn : MODE[m].en)}
              onChange={(m) => { if (m) void act(() => va.patchContact(c.id, { mode: m })); }} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {c.state !== 'owner' ? <AppButton variant="secondary" label={bn ? 'আমি দেখছি' : "I'll handle it"} onPress={() => void act(() => va.patchContact(c.id, { state: 'owner' }))} /> : null}
              {c.state !== 'done' ? <AppButton variant="secondary" label={bn ? 'শেষ' : 'Done'} onPress={() => void act(() => va.patchContact(c.id, { state: 'done' }))} /> : null}
              {c.state !== 'assistant' ? <AppButton variant="secondary" label={bn ? 'সহকারীর হাতে দিন' : 'Hand back'} onPress={() => void act(() => va.patchContact(c.id, { state: 'assistant' }))} /> : null}
            </View>
          </Card>
        </>
      ) : null}
    </Page>
  );
}
