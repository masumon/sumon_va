import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, EmptyNote, useKit } from '../src/ui/AppKit';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { useHealth } from '../src/va/useHealth';
import type { Issue } from '../src/va/health';
import { Hero, HeroStat } from '../src/va/Hero';
import { Page } from '../src/va/Page';
import { openAppSettings, startService } from '../modules/va-bridge';

const SEV = { critical: { tone: 'danger' as const, bn: 'গুরুতর', en: 'Serious', icon: 'alert-circle' as const }, warn: { tone: 'warning' as const, bn: 'সতর্কতা', en: 'Warning', icon: 'alert' as const }, info: { tone: 'neutral' as const, bn: 'তথ্য', en: 'Info', icon: 'information-outline' as const } };

/** Everything the app notices, live: what happened, why, and the button that fixes it. */
export default function HealthScreen() {
  const { bn, colors, language } = useKit();
  const { issues, reload, bridge, loading } = useHealth();
  const serious = issues.filter((i) => i.severity === 'critical').length;
  const warn = issues.filter((i) => i.severity === 'warn').length;

  const fix = (i: Issue) => {
    const f = i.fix;
    if (!f) return;
    if (f.route) router.push(f.route as never);
    else if (f.action === 'restart-sync') { startService(); setTimeout(reload, 1500); }
    else if (f.action === 'app-settings') openAppSettings();
    else reload();
  };

  return (
    <Page title={bn ? 'সমস্যা ও স্বাস্থ্য' : 'Problems & health'} subtitle={bn ? 'এখন কী কী ঠিক নেই — নিজে থেকে হালনাগাদ হয়' : 'What is not right — updates by itself'} onRefresh={reload} refreshing={loading}>
      <Hero icon={serious ? 'alert-circle-outline' : warn ? 'alert-outline' : 'check-decagram-outline'} title={serious ? (bn ? 'গুরুতর সমস্যা আছে' : 'Serious problems') : warn ? (bn ? 'কিছু সতর্কতা' : 'Some warnings') : (bn ? 'সব ঠিক আছে ✓' : 'All good ✓')}
        subtitle={bn ? 'অ্যাপ প্রতি ১৫ সেকেন্ডে নিজে পরীক্ষা করে, আর নতুন সমস্যা এলে নোটিফিকেশন দেয়।' : 'The app checks itself every 15 seconds and notifies you of new problems.'}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <HeroStat value={String(serious)} label={bn ? 'গুরুতর' : 'Serious'} />
          <HeroStat value={String(warn)} label={bn ? 'সতর্কতা' : 'Warnings'} />
          <HeroStat value={bridge.serviceAlive ? (bn ? 'চালু' : 'On') : (bn ? 'বন্ধ' : 'Off')} label={bn ? 'সিঙ্ক' : 'Sync'} />
        </View>
      </Hero>

      {issues.length === 0 ? <EmptyNote icon="check-circle-outline" text={bn ? 'কোনো সমস্যা নেই। বার্তা আসছে, সংযোগ ঠিক, অনুমতি পূর্ণ, AI চলছে।' : 'No problems. Messages arrive, the connection is fine, permissions are complete, the AI works.'} /> : null}
      {issues.map((i) => {
        const s = SEV[i.severity];
        return (
          <Card key={i.key}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AppIcon name={s.icon} size={26} color={i.severity === 'critical' ? colors.danger : i.severity === 'warn' ? colors.warning : colors.textMuted} />
              <Text style={{ flex: 1, fontWeight: '700' }}>{bn ? i.bn : i.en}</Text>
              <AppBadge tone={s.tone} label={bn ? s.bn : s.en} />
            </View>
            <Text style={{ marginTop: 8, opacity: 0.85, lineHeight: 21 }}>{bn ? i.whyBn : i.whyEn}</Text>
            {i.fix ? <View style={{ marginTop: 10 }}><AppButton label={bn ? i.fix.bn : i.fix.en} onPress={() => fix(i)} /></View> : null}
          </Card>
        );
      })}

      <Card title={bn ? 'সংযোগের বিবরণ' : 'Connection details'}>
        <Text>{bn ? 'ব্যাকগ্রাউন্ড সিঙ্ক: ' : 'Background sync: '}{bridge.serviceAlive ? (bn ? 'চালু ✓' : 'running ✓') : (bn ? 'বন্ধ' : 'stopped')}</Text>
        <Text>{bn ? 'শেষ সফল সংযোগ: ' : 'Last successful sync: '}{bridge.lastOk ? formatBangladeshDateTime(new Date(bridge.lastOk), language) : (bn ? 'এখনও হয়নি' : 'not yet')}</Text>
        <Text>{bn ? 'পাঠানোর অপেক্ষায়: ' : 'Waiting to upload: '}{bridge.queued}</Text>
        <Text>{bn ? 'ব্যবহারকারী: ' : 'Account: '}{bridge.accountEmail ?? '—'}</Text>
        {bridge.lastError ? <Text style={{ color: colors.danger }}>{bridge.lastError}</Text> : null}
        <View style={{ marginTop: 10 }}><AppButton variant="secondary" icon="refresh" label={bn ? 'এখনই পরীক্ষা করুন' : 'Check now'} onPress={reload} /></View>
      </Card>
    </Page>
  );
}
