import { View } from 'react-native';
import { Card, ChipGroup, ToggleRow, useKit } from '../ui/AppKit';
import { useAppFeedback } from '../ui/AppFeedback';
import { va, errTone } from './api';
import { useLoad } from './hooks';
import { InfoHint } from './InfoHint';

type Plat = { enabled: boolean; auto_for: 'all' | 'business' | 'known'; alerts: 'all' | 'urgent' | 'off'; hours_on: boolean; hours_from: string; hours_to: string };
const DEFAULT: Plat = { enabled: true, auto_for: 'all', alerts: 'all', hours_on: false, hours_from: '09:00', hours_to: '21:00' };
const AUTO_FOR = ['all', 'business', 'known'] as const;
const ALERTS = ['all', 'urgent', 'off'] as const;
const FROM = ['07:00', '08:00', '09:00', '10:00'] as const;
const TO = ['18:00', '20:00', '21:00', '23:00'] as const;

/**
 * This platform's own settings, the same card on every platform page: pause it, choose who may be answered by itself, set the
 * hours, and choose which of its messages may alert you. Family and personal people are never answered by the assistant on any platform.
 */
export function PlatformSettings({ platform, canAuto }: { platform: string; canAuto: boolean }) {
  const { bn } = useKit();
  const { showSnackbar } = useAppFeedback();
  const cfg = useLoad(() => va.assistantConfig(), 'assistant-config');
  const all = (cfg.data?.config as unknown as { platforms?: Record<string, Partial<Plat>> } | undefined)?.platforms;
  const p: Plat = { ...DEFAULT, ...(all?.[platform] ?? {}) };
  const save = async (patch: Partial<Plat>) => {
    try { await va.saveAssistantConfig({ platforms: { [platform]: patch } }); await cfg.reload(); showSnackbar(bn ? 'সেভ হয়েছে' : 'Saved', 'success'); }
    catch (e) { showSnackbar(e instanceof Error ? e.message : '', errTone(e)); }
  };
  return (
    <Card icon="tune-variant" title={bn ? 'এই প্ল্যাটফর্মের সেটিং' : 'Settings for this platform'}>
      <ToggleRow icon="power" label={bn ? 'চালু' : 'On'} value={p.enabled} onChange={(v) => void save({ enabled: v })} />
      <InfoHint text={bn ? 'বন্ধ করলে এখানকার বার্তা জমা থাকবে, কিন্তু খসড়া বা জরুরি অ্যালার্ট আসবে না।' : 'Off: messages are kept, but no drafts and no alerts.'} />
      {canAuto ? (
        <>
          <ChipGroup label={bn ? 'কাকে নিজে উত্তর দেবে' : 'Who is answered by itself'} options={AUTO_FOR} value={p.auto_for} onChange={(v) => v && void save({ auto_for: v })}
            labelOf={(k) => (k === 'all' ? (bn ? 'সবাই' : 'Everyone') : k === 'business' ? (bn ? 'শুধু ব্যবসা' : 'Business') : (bn ? 'চেনা মানুষ' : 'Known people'))} />
          <ToggleRow icon="clock-outline" label={bn ? 'শুধু নির্দিষ্ট সময়ে' : 'Only during set hours'} value={p.hours_on} onChange={(v) => void save({ hours_on: v })} />
          {p.hours_on ? (
            <View style={{ gap: 8 }}>
              <ChipGroup label={bn ? 'শুরু' : 'From'} options={FROM} value={FROM.includes(p.hours_from as never) ? (p.hours_from as (typeof FROM)[number]) : null} onChange={(v) => v && void save({ hours_from: v })} labelOf={(k) => k} />
              <ChipGroup label={bn ? 'শেষ' : 'Until'} options={TO} value={TO.includes(p.hours_to as never) ? (p.hours_to as (typeof TO)[number]) : null} onChange={(v) => v && void save({ hours_to: v })} labelOf={(k) => k} />
            </View>
          ) : null}
          <InfoHint text={bn ? 'এখানে নিজে উত্তর দেওয়া মানে সহকারী নিজে পাঠাবে। পরিবার ও ব্যক্তিগত মানুষকে কোনো প্ল্যাটফর্মেই নিজে উত্তর দেবে না। সময়ের বাইরে শুধু খসড়া হবে, আপনি পাঠাবেন।' : 'Self-answering means the assistant sends it. Family and personal people are never answered on any platform. Outside the hours you only get drafts.'} />
        </>
      ) : (
        <InfoHint text={bn ? 'এই প্ল্যাটফর্মের বার্তা ফোনের নোটিফিকেশন থেকে পড়া হয়, তাই সহকারী নিজে উত্তর পাঠাতে পারে না। শুধু খসড়া দেয়, আপনি পাঠান।' : 'Messages here are read from the phone’s notifications, so the assistant cannot send replies itself. It writes drafts and you send them.'} />
      )}
      <ChipGroup label={bn ? 'কোন বার্তায় অ্যালার্ট' : 'Which messages alert you'} options={ALERTS} value={p.alerts} onChange={(v) => v && void save({ alerts: v })}
        labelOf={(k) => (k === 'all' ? (bn ? 'সব' : 'All') : k === 'urgent' ? (bn ? 'শুধু জরুরি' : 'Urgent only') : (bn ? 'কোনোটাই না' : 'None'))} hint={bn ? 'পরিবারের বার্তার অ্যালার্ট সবসময় আসবে।' : 'Family alerts always come through.'} />
    </Card>
  );
}
