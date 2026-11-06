import { useState } from 'react';
import { router } from 'expo-router';
import { AppButton } from '../src/ui/AppSurface';
import { Card, ChipGroup, Field, ToggleRow, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { va, errTone } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero } from '../src/va/Hero';
import { CATEGORY, CATEGORY_KEYS } from '../src/va/labels';
import { Page, Status } from '../src/va/Page';
import { InfoHint } from '../src/va/InfoHint';

const SECS = ['10', '20', '40', '60', '120'] as const;
const PER_HOUR = ['3', '5', '10', '20'] as const;
const HOLD = ['2', '6', '12', '24'] as const;
const KEEP = ['30', '60', '90', '180'] as const;
const GROUP = ['0', '3', '5', '7'] as const;
const REMIND = ['0', '10', '15', '20', '30'] as const;
const LEAD = ['0', '30', '60', '120'] as const;
const BURST = ['5', '10', '15'] as const;
const URGENT_PER_DAY = ['3', '5', '10', '20'] as const;

/** How the assistant behaves, as in the admin WhatsApp settings: its names, how fast and how often it replies, when it stays quiet. */
export default function RulesScreen() {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const c = cfg.data?.config;
  const [names, setNames] = useState<{ assistant?: string; owner?: string; replyBy?: string }>({});
  const [lists, setLists] = useState<{ allow?: string; block?: string }>({});

  const save = async (patch: Record<string, unknown>) => {
    try { await va.saveAssistantConfig(patch); await cfg.reload(); showSnackbar(bn ? 'সংরক্ষণ হয়েছে' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };

  return (
    <Page title={bn ? 'সহকারীর অবস্থা ও নিয়ম' : 'Assistant status & rules'} subtitle={bn ? 'কেমন আচরণ করবে, কত তাড়াতাড়ি উত্তর দেবে' : 'How it behaves and how fast it answers'} onRefresh={cfg.reload} refreshing={cfg.loading && !!c}>
      <Status loading={cfg.loading && !c} error={c ? null : cfg.error} onRetry={cfg.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {c ? (
        <>
          <Hero icon="robot-outline" title={c.assistant_name} subtitle={c.enabled ? (c.mode === 'auto' ? (bn ? 'চালু, নিজে উত্তর দেয়' : 'On — replies by itself') : (bn ? 'চালু, শুধু খসড়া' : 'On — drafts only')) : (bn ? 'বন্ধ' : 'Off')} />
          <Card icon="toggle-switch-outline" title={bn ? 'মূল সুইচ' : 'Main switches'}>
            <ToggleRow icon="power" label={bn ? 'সহকারী চালু' : 'Assistant on'} hint={bn ? 'বন্ধ থাকলেও বার্তা ইনবক্সে জমা হবে, শুধু সহকারী কোনো উত্তর বা খসড়া করবে না।' : 'Off: messages still arrive in the inbox; the assistant just does nothing with them.'} value={c.enabled} onChange={(v) => void save({ enabled: v })} />
            <ToggleRow icon="robot-outline" label={bn ? 'নিজে নিজে উত্তর' : 'Reply by itself'} hint={bn ? 'বন্ধ থাকলে শুধু খসড়া হবে, আপনি ঠিক আছে বললে যাবে।' : 'Off = drafts, sent when you approve.'} value={c.mode === 'auto'} onChange={(v) => void save({ mode: v ? 'auto' : 'shadow' })} />
            <ToggleRow icon="brain" label={bn ? 'AI দিয়ে বুঝে নেওয়া' : 'Understand with AI'} value={c.ai.enabled} onChange={(v) => void save({ ai: { enabled: v } })} />
            <ToggleRow icon="microphone-outline" label={bn ? 'ভয়েস মেসেজ লিখে ফেলা' : 'Transcribe voice notes'} value={c.ai.voice} onChange={(v) => void save({ ai: { voice: v } })} />
          </Card>

          <Card icon="calendar-clock" title={bn ? 'সময়সূচি, অবস্থা ও জায়গা' : 'Routine, status and places'}>
            <AppButton variant="secondary" icon="calendar-clock" label={bn ? 'খুলুন' : 'Open'} onPress={() => router.push('/routine' as never)} />
          </Card>

          <Card icon="shape-outline" title={bn ? 'কোন ধরনের বার্তায় কী করবে' : 'What to do with each kind of message'}>
            <InfoHint text={bn ? 'সহকারী প্রতিটি বার্তা পড়ে ব্যবসায়িক, ব্যক্তিগত, সামাজিক বা স্প্যাম ঠিক করে। কোনগুলোতে নিজে উত্তর দেবে, তা এখানে ঠিক করুন।' : 'The assistant sorts each message as business, personal, social or spam. Choose where it may answer by itself.'} />
            {CATEGORY_KEYS.filter((k) => k !== 'spam').map((k) => (
              <ToggleRow key={k} icon={CATEGORY[k].icon} label={`${bn ? CATEGORY[k].bn : CATEGORY[k].en}: ${(c.categories?.[k]?.auto ?? k === 'business') ? (bn ? 'নিজে উত্তর দেবে' : 'replies by itself') : (bn ? 'শুধু খসড়া' : 'drafts only')}`}
                hint={bn ? CATEGORY[k].hintBn : CATEGORY[k].hintEn} value={c.categories?.[k]?.auto ?? k === 'business'} onChange={(v) => void save({ categories: { [k]: { auto: v } } })} />
            ))}
            <InfoHint text={bn ? 'পরিবার সব সময় ব্যক্তিগত, সেখানে সহকারী কখনও নিজে উত্তর দেয় না। স্প্যাম আলাদা হয়ে যায়।' : 'Family is always personal — never answered by the assistant. Spam is quietly set aside.'} />
          </Card>

          <Card icon="account-edit-outline" title={bn ? 'নাম ও কথার ধরন' : 'Names and wording'}>
            <Field label={bn ? 'সহকারীর নাম' : 'Assistant name'} value={names.assistant ?? c.assistant_name} onChangeText={(v) => setNames((s) => ({ ...s, assistant: v }))} />
            <Field label={bn ? 'আপনার নাম (সহকারী যা বলবে)' : 'Your name (as the assistant says it)'} value={names.owner ?? c.owner_name} onChangeText={(v) => setNames((s) => ({ ...s, owner: v }))} />
            <Field label={bn ? '“কখন উত্তর পাবেন” বলার ধরন' : 'How it says when you will reply'} value={names.replyBy ?? c.reply_by} onChangeText={(v) => setNames((s) => ({ ...s, replyBy: v }))} hint={bn ? 'যেমন: পরে সুযোগ পেলেই' : 'e.g. as soon as he can'} />
            <AppButton label={bn ? 'নাম ও কথা সংরক্ষণ' : 'Save names and wording'} disabled={!names.assistant && !names.owner && !names.replyBy}
              onPress={() => void save({ assistant_name: names.assistant ?? c.assistant_name, owner_name: names.owner ?? c.owner_name, reply_by: names.replyBy ?? c.reply_by }).then(() => setNames({}))} />
          </Card>

          <Card icon="speedometer" title={bn ? 'গতি ও সীমা' : 'Speed and limits'}>
            <ChipGroup<(typeof SECS)[number]> label={bn ? 'উত্তরের আগে অপেক্ষা (সর্বোচ্চ সেকেন্ড)' : 'Wait before replying (max seconds)'} options={SECS} value={String(c.delay.max) as (typeof SECS)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ delay: { min: Math.min(20, Number(s)), max: Number(s) } }); }} />
            <ChipGroup<(typeof PER_HOUR)[number]> label={bn ? 'একজনকে ঘণ্টায় সর্বোচ্চ অটো-উত্তর' : 'Max auto-replies to one person per hour'} options={PER_HOUR} value={String(c.per_sender_hour) as (typeof PER_HOUR)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ per_sender_hour: Number(s) }); }} />
            <ChipGroup<(typeof HOLD)[number]> label={bn ? 'আমি নিজে উত্তর দিলে সহকারী চুপ থাকবে (ঘণ্টা)' : 'Stay quiet after I answer (hours)'} options={HOLD} value={String(c.hold_hours) as (typeof HOLD)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ hold_hours: Number(s) }); }} />
          </Card>

          <Card icon="brain" title={bn ? 'বুদ্ধিমান সহকারীর সেটিং' : 'Smart assistant settings'}>
            <InfoHint text={bn ? 'এগুলো বন্ধ থাকলে সহকারী ওই কাজ করে না। এখানে চালু করলে তবেই রিমাইন্ডার ও গ্রুপিং কাজ করবে।' : 'While these are off the assistant skips that job. Switch them on here.'} />
            <ChipGroup<(typeof GROUP)[number]> label={bn ? 'একই মানুষের কয়েকটি বার্তা একসঙ্গে ধরে একটি উত্তর (মিনিট, ০ = বন্ধ)' : 'Group several messages from one person into one reply (minutes, 0 = off)'} options={GROUP} value={String(c.grouping?.window_min ?? 5) as (typeof GROUP)[number]} labelOf={(s) => s}
              onChange={(s) => { if (s) void save({ grouping: { window_min: Number(s) } }); }} hint={bn ? 'জরুরি বার্তা অপেক্ষা করে না।' : 'Urgent messages never wait.'} />
            <ChipGroup<(typeof REMIND)[number]> label={bn ? '“উত্তর বাকি” মনে করানো (মিনিট পর, ০ = বন্ধ)' : '“Still unanswered” reminder (after minutes, 0 = off)'} options={REMIND} value={String(c.reminders?.unanswered_min ?? 0) as (typeof REMIND)[number]} labelOf={(s) => s}
              onChange={(s) => { if (s) void save({ reminders: { unanswered_min: Number(s) } }); }} hint={bn ? 'শুধু বলে “উত্তর দেওয়ার প্রমাণ পাইনি”। বার্তা পড়া হয়েছে কি না, তা কখনও বলে না।' : 'It only says no answer was found. It never claims the message was read.'} />
            <ToggleRow icon="star-outline" label={bn ? 'শুধু গুরুত্বপূর্ণ মানুষের জন্য মনে করানো' : 'Remind only for important people'} value={c.reminders?.only_important ?? true} onChange={(v) => void save({ reminders: { only_important: v } })} />
            <ChipGroup<(typeof LEAD)[number]> label={bn ? 'কাজের সময়ের আগে মনে করানো (মিনিট, ০ = বন্ধ)' : 'Remind before a task is due (minutes, 0 = off)'} options={LEAD} value={String(c.reminders?.task_lead_min ?? 0) as (typeof LEAD)[number]} labelOf={(s) => s}
              onChange={(s) => { if (s) void save({ reminders: { task_lead_min: Number(s) } }); }} />
            <ChipGroup<(typeof BURST)[number]> label={bn ? 'বারবার মিসড কল: এই সময়ের মধ্যে একটাই অ্যালার্ট (মিনিট)' : 'Repeated missed calls: one alert within (minutes)'} options={BURST} value={String(c.calls?.burst_min ?? 10) as (typeof BURST)[number]} labelOf={(s) => s}
              onChange={(s) => { if (s) void save({ calls: { burst_min: Number(s) } }); }} />
            <ChipGroup<(typeof URGENT_PER_DAY)[number]> label={bn ? 'দিনে সর্বোচ্চ জরুরি অ্যালার্ট' : 'Max urgent alerts per day'} options={URGENT_PER_DAY} value={String(c.limits?.urgent_per_day ?? 5) as (typeof URGENT_PER_DAY)[number]} labelOf={(s) => s}
              onChange={(s) => { if (s) void save({ limits: { urgent_per_day: Number(s) } }); }} hint={bn ? 'সীমা বা নীরব সময়ে আটকে গেলে অ্যালার্ট হারায় না: আপনি পরে সারাংশ পাবেন।' : 'Alerts held back by the limit or quiet hours are not lost: you get a summary later.'} />
          </Card>

          <Card icon="email-off-outline" title={bn ? 'স্প্যাম ও প্রচার' : 'Spam and promotions'}>
            <ToggleRow icon="filter-remove-outline" label={bn ? 'অপারেটর ও দোকানের অফার স্প্যামে পাঠাও' : 'Send operator and shop offers to spam'} hint={bn ? 'GP, Robi, Banglalink, Airtel, Teletalk, Circle ও অ্যাপের বিজ্ঞাপন। bKash, ব্যাংক বা কোডের SMS কখনো নয়।' : 'GP, Robi, Banglalink, Airtel, Teletalk, Circle and app adverts. Never bKash, bank or code SMS.'}
              value={c.promo?.enabled ?? true} onChange={(v) => void save({ promo: { enabled: v } })} />
            <Field label={bn ? 'কখনো স্প্যাম নয় (নাম/নম্বর, কমা দিয়ে)' : 'Never spam (names/numbers, comma separated)'} value={lists.allow ?? (c.promo?.allow ?? []).join(', ')} onChangeText={(v) => setLists((s) => ({ ...s, allow: v }))} />
            <Field label={bn ? 'সব সময় স্প্যাম (নাম/নম্বর, কমা দিয়ে)' : 'Always spam (names/numbers, comma separated)'} value={lists.block ?? (c.promo?.block ?? []).join(', ')} onChangeText={(v) => setLists((s) => ({ ...s, block: v }))} />
            <AppButton variant="secondary" label={bn ? 'তালিকা সংরক্ষণ' : 'Save lists'} disabled={lists.allow === undefined && lists.block === undefined}
              onPress={() => { const split = (t?: string, d: string[] = []) => (t === undefined ? d : t.split(',').map((x) => x.trim()).filter(Boolean)); void save({ promo: { allow: split(lists.allow, c.promo?.allow), block: split(lists.block, c.promo?.block) } }).then(() => setLists({})); }} />
          </Card>

          <Card icon="bell-outline" title={bn ? 'জানানো ও রাখা' : 'Notify and keep'}>
            <ToggleRow icon="bell-alert-outline" label={bn ? 'জরুরি হলে আমাকে জানান' : 'Tell me when urgent'} value={c.notify.urgent} onChange={(v) => void save({ notify: { urgent: v } })} />
            <ToggleRow icon="calendar-today" label={bn ? 'প্রতিদিন সারাংশ' : 'Daily summary'} hint={c.notify.digest ? (bn ? `প্রতিদিন ${c.notify.digest_time}-এ` : `Every day at ${c.notify.digest_time}`) : undefined} value={c.notify.digest} onChange={(v) => void save({ notify: { digest: v } })} />
            <ChipGroup<(typeof KEEP)[number]> label={bn ? 'বার্তা কত দিন রাখবে' : 'Keep messages for (days)'} options={KEEP} value={String(c.retention_days) as (typeof KEEP)[number]} labelOf={(s) => s} onChange={(s) => { if (s) void save({ retention_days: Number(s) }); }} />
          </Card>
          <InfoHint text={bn ? 'উত্তরের লেখা, শব্দ-তালিকা ও আরও গভীর নিয়ম এখনও অ্যাডমিনের WhatsApp সহকারী, সেটিংস ট্যাব থেকে বদলাতে হয়।' : 'Reply scripts, word lists and deep rules are still edited in the admin → WhatsApp assistant → Settings.'} />
        </>
      ) : null}
    </Page>
  );
}
