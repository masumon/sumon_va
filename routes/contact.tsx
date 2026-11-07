import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { va, type Contact, type Message, errTone } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Page, Status } from '../src/va/Page';
import { BrandLogo, brandFor, brandName } from '../src/va/BrandLogo';
import { TagEditor } from '../src/va/TagEditor';
import { ChatTransfer } from '../src/va/ChatTransfer';
import { HistoryImport } from '../src/va/HistoryImport';
import { ContactMemory } from '../src/va/ContactMemory';
import { ChatMenuButton } from '../src/va/ChatMenu';
import { AppIcon } from '../src/ui/AppIcon';
import { CATEGORY, CATEGORY_KEYS, CHANNEL, MESSAGE_STATUS, MODE, PRIORITY, displayName } from '../src/va/labels';

const MODES: Contact['mode'][] = ['inherit', 'auto', 'telegram', 'draft', 'notify'];

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

function Bubble({ m }: { m: Message }) {
  const { colors, bn, language } = useKit();
  const mine = m.direction === 'out';
  // A status this app version does not know yet must never crash the chat: show the plain code instead.
  const st = MESSAGE_STATUS[m.status] ?? { bn: String(m.status ?? ''), en: String(m.status ?? '') };
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
  const [aliasText, setAliasText] = useState('');
  const [more, setMore] = useState(false); // the person's details and rules stay folded, so the chat page stays simple
  const aliases = useLoad(() => va.aliases(String(id)), `aliases:${String(id)}`, 60000);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await detail.reload(); if (ok) showSnackbar(ok, 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
    finally { setBusy(false); }
  };

  const c = detail.data?.contact;
  const drafts = (detail.data?.messages ?? []).filter((m) => m.status === 'draft');
  const pr = c ? (PRIORITY[c.priority] ?? PRIORITY[5]!) : null;

  return (
    <Page title={c ? displayName(c) : '…'} subtitle={c ? (bn ? CHANNEL[c.channel]?.bn : CHANNEL[c.channel]?.en) ?? c.channel : undefined} back={bn ? 'ইনবক্স' : 'Inbox'} right={c ? <ChatMenuButton contact={c} onChanged={() => void detail.reload()} size={26} /> : null} onRefresh={detail.reload} refreshing={detail.loading && !!detail.data}
      footer={c ? (
        <View style={{ gap: 8 }}>
          <Field label="" value={text} onChangeText={setText} multiline placeholder={bn ? 'আপনার উত্তর লিখুন…' : 'Write your reply…'} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><AppButton label={bn ? 'পাঠান' : 'Send'} icon="send" loading={busy} disabled={!text.trim()}
              onPress={() => void act(async () => { await va.reply(c.id, text.trim()); setText(''); }, bn ? 'পাঠানোর জন্য দেওয়া হয়েছে' : 'Handed over for sending')} /></View>
            <View style={{ flex: 1 }}><AppButton variant="secondary" icon="auto-fix" label={bn ? 'সহকারী লিখুক' : 'Draft it'} loading={busy}
              onPress={() => void act(async () => { const r = await va.suggest(c.id); setText(r.text ?? r.reply ?? ''); })} /></View>
          </View>
        </View>
      ) : null}>
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

          {drafts.map((d) => (
            <Card key={d.id} title={bn ? 'সহকারীর খসড়া উত্তর' : "Assistant's draft reply"}>
              <Text style={{ marginBottom: 6 }}>{d.body}</Text>
              {d.note ? <Text style={{ opacity: 0.7, fontSize: 12, marginBottom: 10 }}>{bn ? 'কারণ: ' : 'Why: '}{d.note}</Text> : null}
              <View style={{ gap: 8 }}>
                <AppButton label={bn ? 'এটাই পাঠান' : 'Send this'} icon="send" loading={busy} onPress={() => void act(() => va.approve(d.id), bn ? 'পাঠানোর জন্য দেওয়া হয়েছে (পৌঁছালে তালিকায় দেখাবে)' : 'Handed over for sending (shows in the list once delivered)')} />
                <AppButton variant="secondary" label={bn ? 'বাদ দিন' : 'Discard'} onPress={() => void act(() => va.discard(d.id))} />
              </View>
            </Card>
          ))}

          <View style={{ gap: 14 }}>{detail.data!.messages.map((m) => <Bubble key={m.id} m={m} />)}</View>


          <Card>
            <Text style={{ opacity: 0.75, marginBottom: 8 }}>{bn ? 'WhatsApp বা অন্য অ্যাপে নিজে উত্তর দিয়ে থাকলে চাপুন, সহকারী তখন আর উত্তর দেবে না।' : 'Answered in the chat app yourself? Tap, and the assistant will not answer again.'}</Text>
            <AppButton variant="secondary" icon="check-circle-outline" label={bn ? 'আমি নিজে উত্তর দিয়েছি' : 'I answered myself'} loading={busy}
              onPress={() => void act(() => va.sentByHand(c.id, text.trim() || (bn ? '(নিজে উত্তর দিয়েছি)' : '(I answered myself)')), bn ? 'লিখে রাখা হলো। সহকারী কিছুক্ষণ চুপ থাকবে' : 'Noted. The assistant will stay quiet for a while')} />
          </Card>

          <AppButton variant="secondary" icon={more ? 'chevron-up' : 'chevron-down'} label={more ? (bn ? 'তথ্য ও নিয়ম লুকান' : 'Hide details and rules') : (bn ? 'এই মানুষের তথ্য ও নিয়ম' : 'This person’s details and rules')} onPress={() => setMore((v) => !v)} />
          {more ? (<>
          <ChatTransfer contactId={c.id} isPrivate={c.is_family || c.category === 'personal'} onLearned={() => void detail.reload()} />

          <HistoryImport contactId={c.id} isPrivate={c.is_family || c.category === 'personal'} />

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
            <ChipGroup<Contact['mode']> label={bn ? 'উত্তরের ধরন' : 'Reply style'} options={MODES} value={c.mode} labelOf={(m) => (bn ? MODE[m]?.bn : MODE[m]?.en) ?? m}
              hint={bn ? '“নিজে উত্তর”: সহকারী এই মানুষকে নিজেই উত্তর দেবে। “Telegram-এ অনুমোদন”: প্রতিটি বার্তা খসড়াসহ আপনার Telegram বটে যাবে, সেখানে “পাঠান” চাপুন বা Reply-তে নিজে লিখুন। “শুধু খসড়া”: আপনি অ্যাপে দেখে পাঠাবেন। পরিবার ও ব্যক্তিগত মানুষকে কখনও নিজে উত্তর যায় না।' : '“Auto-reply”: the assistant answers this person itself. “Approve in Telegram”: each message comes to your Telegram bot with a draft; tap Send or reply there. “Drafts only”: you send from the app. Family and personal people never get auto-replies.'}
              onChange={(m) => { if (m) void act(() => va.patchContact(c.id, { mode: m })); }} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {c.state !== 'owner' ? <AppButton variant="secondary" label={bn ? 'আমি দেখছি' : "I'll handle it"} onPress={() => void act(() => va.patchContact(c.id, { state: 'owner' }))} /> : null}
              {c.state !== 'done' ? <AppButton variant="secondary" label={bn ? 'শেষ' : 'Done'} onPress={() => void act(() => va.patchContact(c.id, { state: 'done' }))} /> : null}
              {c.state !== 'assistant' ? <AppButton variant="secondary" label={bn ? 'সহকারীর হাতে দিন' : 'Hand back'} onPress={() => void act(() => va.patchContact(c.id, { state: 'assistant' }))} /> : null}
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
          </>) : null}
        </>
      ) : null}
    </Page>
  );
}
