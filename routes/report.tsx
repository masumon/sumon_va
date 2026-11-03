import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { Card, ChipGroup, useKit } from '../src/ui/AppKit';
import { formatBangladeshNumber } from '../src/i18n/date-time';
import { va } from '../src/va/api';
import { useLoad } from '../src/va/hooks';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page, Status } from '../src/va/Page';
import { StatTile, TileGrid } from '../src/va/StatTile';

const REASON_BN: Record<string, string> = { greeting: 'পরিচয়', thanks: 'ধন্যবাদ/তথ্য নেওয়া', urgent: 'জরুরি বার্তা', ask: 'প্রশ্ন করা', unknown: 'জানা নেই', note: 'আপনার নোট', identity: 'মানুষ কি না', upset: 'বারবার লেখা', salam: 'সালাম', voice: 'ভয়েস', money_or_family: 'টাকা/পরিবার', work: 'কাজ', group: 'গ্রুপ', spam: 'স্প্যাম', general: 'সাধারণ' };
const DAYS = ['7', '14', '30'] as const;

/** How the assistant did: how many messages came, how many it answered, how many drafts you approved. */
export default function ReportScreen() {
  const { bn, colors, language } = useKit();
  const [days, setDays] = useState<(typeof DAYS)[number]>('7');
  const rep = useLoad(() => va.report(Number(days)), `report-${days}`, 60000);
  const n = (v: number) => formatBangladeshNumber(v, language);
  const d = rep.data;
  const max = Math.max(1, ...(d?.per_day ?? []).map((x) => x.in + x.out));

  return (
    <Page title={bn ? 'রিপোর্ট' : 'Report'} subtitle={bn ? 'সহকারী কেমন কাজ করছে' : 'How the assistant is doing'} back={bn ? 'নিয়ম' : 'Rules'} onRefresh={rep.reload} refreshing={rep.loading && !!d}>
      <ChipGroup<(typeof DAYS)[number]> options={DAYS} value={days} labelOf={(v) => (bn ? `${n(Number(v))} দিন` : `${v} days`)} onChange={(v) => { if (v) setDays(v); }} />
      <Status loading={rep.loading && !d} error={d ? null : rep.error} onRetry={rep.reload} retryLabel={bn ? 'আবার চেষ্টা' : 'Retry'} />
      {d ? (
        <>
          <Hero icon="chart-box-outline" title={bn ? `${n(d.counts.in ?? 0)}টি বার্তা এসেছে` : `${d.counts.in ?? 0} messages came in`} subtitle={d.avg_reply_seconds != null ? (bn ? `গড়ে ${n(d.avg_reply_seconds)} সেকেন্ডে উত্তর` : `Replied in ${d.avg_reply_seconds}s on average`) : undefined}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <HeroStat value={n(d.counts.sent ?? 0)} label={bn ? 'পাঠানো' : 'Sent'} />
              <HeroStat value={n(d.counts.draft ?? 0)} label={bn ? 'খসড়া' : 'Drafts'} />
              <HeroStat value={d.approval_rate != null ? `${n(d.approval_rate)}%` : '—'} label={bn ? 'অনুমোদন হার' : 'Approved'} />
            </View>
          </Hero>
          <TileGrid>
            <StatTile icon="thumb-up-outline" label={bn ? 'ভালো উত্তর' : 'Good replies'} value={n(d.counts.good ?? 0)} />
            <StatTile icon="thumb-down-outline" label={bn ? 'খারাপ উত্তর' : 'Bad replies'} value={n(d.counts.bad ?? 0)} />
            <StatTile icon="delete-outline" label={bn ? 'বাতিল খসড়া' : 'Discarded drafts'} value={n(d.counts.discarded ?? 0)} />
            <StatTile icon="alert-circle-outline" label={bn ? 'পাঠানো যায়নি' : 'Failed'} value={n(d.counts.failed ?? 0)} />
          </TileGrid>
          <Card title={bn ? 'দিন ধরে' : 'Day by day'}>
            {d.per_day.length === 0 ? <Text style={{ opacity: 0.7 }}>{bn ? 'এখনও কোনো তথ্য নেই।' : 'No data yet.'}</Text> : d.per_day.map((x) => (
              <View key={x.day} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>{x.day} · {bn ? `${n(x.in)} এসেছে, ${n(x.out)} গেছে` : `${x.in} in, ${x.out} out`}</Text>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden', flexDirection: 'row' }}>
                  <View style={{ width: `${(x.in / max) * 100}%`, backgroundColor: colors.primary }} />
                  <View style={{ width: `${(x.out / max) * 100}%`, backgroundColor: colors.success }} />
                </View>
              </View>
            ))}
          </Card>
          <Card title={bn ? 'কোন কারণে উত্তর গেছে' : 'Why replies were made'}>
            {Object.keys(d.by_reason).length === 0 ? <Text style={{ opacity: 0.7 }}>{bn ? 'এখনও নেই।' : 'None yet.'}</Text> : Object.entries(d.by_reason).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}><Text>{bn ? (REASON_BN[k] ?? k) : k}</Text><Text style={{ fontWeight: '700' }}>{n(v)}</Text></View>
            ))}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
