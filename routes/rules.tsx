import { useState } from 'react';
import { AppText as Text } from '../src/ui/AppText';
import { AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { CATEGORY, CATEGORY_KEYS } from '../src/va/labels';
import { Page, Status } from '../src/va/Page';

const SECS = ['10', '20', '40', '60', '120'] as const;
const PER_HOUR = ['3', '5', '10', '20'] as const;
const HOLD = ['2', '6', '12', '24'] as const;
const KEEP = ['30', '60', '90', '180'] as const;

/** How the assistant behaves, as in the admin WhatsApp settings: its names, how fast and how often it replies, when it stays quiet. */
export default function RulesScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const c = cfg.data?.config;
  const [names, setNames] = useState<{ assistant?: string; owner?: string; replyBy?: string }>({});

  const save = async (patch: Record<string, unknown>) => {
    try { await va.saveAssistantConfig(patch); await cfg.reload(); showSnackbar(bn ? 'সংরক্ষিত' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', 'danger'); }
  };

  return (
    <Page title={bn ? 'সহকারীর অবস্থা ও নিয়ম' : 'Assistant status & rules'} subtitle={bn ? 'কেমন আচরণ করবে, কত তাড়াতাড়ি উত্তর দেবে' : 'How it behaves and how fast it answers'} onRefresh={cfg.reload} refreshing={cfg.loading && !!c}>
      <Status loading={cfg.loading && !c} error={c ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c ? (
        <>
          <Hero icon="robot-outline" title={c.assistant_name} subtitle={c.enabled ? (c.mode === 'auto' ? (bn ? 'চালু — নিজে উত্তর দেয়' : 'On — replies by itself') : (bn ? 'চালু — শুধু খসড়া' : 'On — drafts only')) : (bn ? 'বন্ধ' : 'Off')} />
          <Card title={bn ? 'মূল সুইচ' : 'Main switches'}>
            <ToggleRow icon="power" label={bn ? 'সহকারী চালু' : 'Assistant on'} hint={bn ? 'বন্ধ থাকলে কিছুই করে না।' : 'Off = does nothing.'} value={c.enabled} onChange={(v) => void save({ enabled: v })} />
            <ToggleRow icon="robot-outline" label={bn ? 'নিজে নিজে উত্তর' : 'Reply by itself'} hint={bn ? 'বন্ধ = শুধু খসড়া, আপনি অনুমোদন করলে যাবে।' : 'Off = drafts, sent when you approve.'} value={c.mode === 'auto'} onChange={(v) => void save({ mode: v ? 'auto' : 'shadow' })} />
            <ToggleRow icon="brain" label={bn ? 'AI দিয়ে বোঝা' : 'Understand with AI'} value={c.ai.enabled} onChange={(v) => void save({ ai: { enabled: v } })} />
            <ToggleRow icon="microphone-outline" label={bn ? 'ভয়েস মেসেজ লিখে ফেলা' : 'Transcribe voice notes'} value={c.ai.voice} onChange={(v) => void save({ ai: { voice: v } })} />
          </Card>

          <Card title={bn ? 'কোন ধরনের বার্তায় কী করবে' : 'What to do with each kind of message'}>
            <Text style={{ opacity: 0.75, marginBottom: 6 }}>{bn ? 'সহকারী প্রতিটি বার্তা পড়ে ব্যবসায়িক, ব্যক্তিগত, সামাজিক বা স্প্যাম ঠিক করে। কোনটায় নিজে উত্তর দেবে সেটা এখানে ঠিক করুন।' : 'The assistant sorts each message as business, personal, social or spam. Choose where it may answer by itself.'}</Text>
            {CATEGORY_KEYS.filter((k) => k !== 'spam').map((k) => (
              <ToggleRow key={k} icon={CATEGORY[k].icon} label={`${bn ? CATEGORY[k].bn : CATEGORY[k].en} — ${(c.categories?.[k]?.auto ?? k === 'business') ? (bn ? 'নিজে উত্তর দেবে' : 'replies by itself') : (bn ? 'শুধু খসড়া' : 'drafts only')}`}
                hint={bn ? CATEGORY[k].hintBn : CATEGORY[k].hintEn} value={c.categories?.[k]?.auto ?? k === 'business'} onChange={(v) => void save({ categories: { [k]: { auto: v } } })} />
            ))}
            <Text style={{ opacity: 0.65, fontSize: 12, marginTop: 6 }}>{bn ? 'পরিবার সবসময় ব্যক্তিগত — সেখানে সহকারী কখনও নিজে উত্তর দেয় না। স্প্যাম চুপচাপ সরে যায়।' : 'Family is always personal — never answered by the assistant. Spam is quietly set aside.'}</Text>
          </Card>

          <Card title={bn ? 'নাম ও কথার ধরন' : 'Names and wording'}>
            <Field label={bn ? 'সহকারীর নাম' : 'Assistant name'} value={names.assistant ?? c.assistant_name} onChangeText={(v) => setNames((s) => ({ ...s, assistant: v }))} />
            <Field label={bn ? 'আপনার নাম (সহকারী যা বলবে)' : 'Your name (as the assistant says it)'} value={names.owner ?? c.owner_name} onChangeText={(v) => setNames((s) => ({ ...s, owner: v }))} />
            <Field label={bn ? '“কখন উত্তর পাবেন” বলার ধরন' : 'How it says when you will reply'} value={names.replyBy ?? c.reply_by} onChangeText={(v) => setNames((s) => ({ ...s, replyBy: v }))} hint={bn ? 'যেমন: পরে সুযোগ পেলেই' : 'e.g. as soon as he can'} />
            <AppButton label={bn ? 'নাম ও কথা সংরক্ষণ' : 'Save names and wording'} disabled={!names.assistant && !names.owner && !names.replyBy}
              onPress={() => void save({ assistant_name: names.assistant ?? c.assistant_name, owner_name: names.owner ?? c.owner_name, reply_by: names.replyBy ?? c.reply_by }).then(() => setNames({}))} />
          </Card>

          <Card title={bn ? 'গতি ও সীমা' : 'Speed and limits'}>
            <ChipGroup<(typeof SECS)[number]> label={bn ? 'উত্তরের আগে অপেক্ষা (সর্বোচ্চ সেকেন্ড)' : 'Wait before replying (max seconds)'} options={SECS} value={String(c.delay.max) as (typeof SECS)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ delay: { min: Math.min(20, Number(s)), max: Number(s) } }); }} />
            <ChipGroup<(typeof PER_HOUR)[number]> label={bn ? 'একজনকে ঘণ্টায় সর্বোচ্চ অটো-উত্তর' : 'Max auto-replies to one person per hour'} options={PER_HOUR} value={String(c.per_sender_hour) as (typeof PER_HOUR)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ per_sender_hour: Number(s) }); }} />
            <ChipGroup<(typeof HOLD)[number]> label={bn ? 'আমি নিজে উত্তর দিলে সহকারী চুপ থাকবে (ঘণ্টা)' : 'Stay quiet after I answer (hours)'} options={HOLD} value={String(c.hold_hours) as (typeof HOLD)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ hold_hours: Number(s) }); }} />
          </Card>

          <Card title={bn ? 'জানানো ও রাখা' : 'Notify and keep'}>
            <ToggleRow icon="bell-alert-outline" label={bn ? 'জরুরি হলে জানাও' : 'Tell me when urgent'} value={c.notify.urgent} onChange={(v) => void save({ notify: { urgent: v } })} />
            <ToggleRow icon="calendar-today" label={bn ? 'প্রতিদিন সারাংশ' : 'Daily summary'} hint={c.notify.digest ? (bn ? `প্রতিদিন ${c.notify.digest_time}-এ` : `Every day at ${c.notify.digest_time}`) : undefined} value={c.notify.digest} onChange={(v) => void save({ notify: { digest: v } })} />
            <ChipGroup<(typeof KEEP)[number]> label={bn ? 'বার্তা কত দিন রাখবে' : 'Keep messages for (days)'} options={KEEP} value={String(c.retention_days) as (typeof KEEP)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ retention_days: Number(s) }); }} />
          </Card>
          <Text style={{ opacity: 0.65, fontSize: 12, lineHeight: 18 }}>{bn ? 'উত্তরের লেখা (স্ক্রিপ্ট), শব্দ-তালিকা ও গভীর নিয়ম এখনও অ্যাডমিনের WhatsApp সহকারী → সেটিংস ট্যাবে বদলাতে হয়।' : 'Reply scripts, word lists and deep rules are still edited in the admin → WhatsApp assistant → Settings.'}</Text>
        </>
      ) : null}
    </Page>
  );
}
