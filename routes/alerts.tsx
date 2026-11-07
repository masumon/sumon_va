import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { Card, EmptyNote, useKit } from '../src/ui/AppKit';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { useHealth } from '../src/va/useHealth';
import { Page } from '../src/va/Page';
import { alertHistory, clearAlertHistory, type AlertHistoryItem } from '../modules/va-bridge';

const SEV = {
  critical: { tone: 'danger' as const, bn: 'গুরুতর', en: 'Serious', icon: 'alert-circle' as const },
  warn: { tone: 'warning' as const, bn: 'সতর্কতা', en: 'Warning', icon: 'alert' as const },
  info: { tone: 'neutral' as const, bn: 'তথ্য', en: 'Info', icon: 'information-outline' as const },
};
const isUrgent = (a: AlertHistoryItem) => /জরুরি|urgent/iu.test(`${a.title} ${a.sub} ${a.target}`);

/** The notification centre: what is wrong right now, and below it everything the phone has alerted about. */
export default function AlertsScreen() {
  const { bn, colors, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const { issues, reload } = useHealth();
  const [items, setItems] = useState<AlertHistoryItem[]>([]);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => { setItems([...alertHistory()].sort((a, b) => b.at - a.at)); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Every alert opens its place: the chat it is about, else the right inbox list (never a dead tap).
  const open = (a: AlertHistoryItem) => {
    const id = (a.open ?? '').match(/^contact\?id=([0-9a-fA-F-]{32,36})$/)?.[1];
    if (id) { router.push({ pathname: '/contact', params: { id } } as never); return; }
    if (a.target.startsWith('/')) {
      const [path, query] = a.target.split('?');
      const params = Object.fromEntries(new URLSearchParams(query ?? '').entries());
      router.push((query ? { pathname: path, params } : path) as never);
      return;
    }
    if (a.id.startsWith('problem-')) { router.push('/health' as never); return; }
    router.push({ pathname: '/inbox', params: { view: a.target === 'p1' ? 'urgent' : 'waiting' } } as never);
  };

  return (
    <Page title={bn ? 'বিজ্ঞপ্তি' : 'Notifications'} subtitle={bn ? 'এখনকার সমস্যা ও আগের অ্যালার্টগুলো' : 'Current problems and past alerts'} onRefresh={() => { reload(); load(); }}>
      <Text style={{ fontWeight: '800', fontSize: 15, color: colors.textPrimary }}>{bn ? 'এখনকার সমস্যা' : 'Problems right now'}</Text>
      {issues.length === 0 ? <EmptyNote icon="check-circle-outline" text={bn ? 'এখন কোনো সমস্যা নেই ✓' : 'No problems right now ✓'} /> : null}
      {issues.map((i) => {
        const s = SEV[i.severity];
        const tint = i.severity === 'critical' ? colors.danger : i.severity === 'warn' ? colors.warning : colors.info;
        return (
          <Pressable key={i.key} accessibilityRole="button" accessibilityLabel={`${bn ? s.bn : s.en}: ${bn ? i.bn : i.en}`} onPress={() => router.push('/health' as never)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppIcon name={s.icon} size={24} color={tint} />
                <Text style={{ flex: 1, fontWeight: '700', color: colors.textPrimary }}>{bn ? i.bn : i.en}</Text>
                <AppBadge tone={s.tone} label={bn ? s.bn : s.en} />
              </View>
              <Text style={{ marginTop: 6, color: colors.textSecondary, lineHeight: 21 }}>{bn ? i.whyBn : i.whyEn}</Text>
            </Card>
          </Pressable>
        );
      })}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <Text style={{ fontWeight: '800', fontSize: 15, color: colors.textPrimary }}>{bn ? 'আগের অ্যালার্ট' : 'Past alerts'}</Text>
        {items.length > 0 ? <AppButton variant="secondary" icon="trash-can-outline" label={bn ? 'মুছুন' : 'Clear'} onPress={() => setConfirm(true)} /> : null}
      </View>
      {items.length === 0 ? <EmptyNote icon="bell-outline" text={bn ? 'এখনও কোনো অ্যালার্ট আসেনি' : 'No alerts yet'} /> : null}
      {items.map((a) => {
        const urgent = isUrgent(a);
        return (
          <Pressable key={`${a.id}-${a.at}`} accessibilityRole="button" accessibilityLabel={`${a.title}. ${a.text}`} onPress={() => open(a)}
            style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1, padding: 12, borderRadius: 16, borderWidth: urgent ? 2 : 1, borderColor: urgent ? colors.danger : colors.border, backgroundColor: colors.surface, gap: 2 })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={urgent ? 'alert-octagon-outline' : 'bell-outline'} size={20} color={urgent ? colors.danger : colors.textMuted} />
              <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', color: urgent ? colors.danger : colors.textPrimary }}>{a.title}</Text>
              {urgent ? <AppBadge tone="danger" label={bn ? 'জরুরি' : 'Urgent'} /> : null}
            </View>
            {a.text ? <Text numberOfLines={3} style={{ color: colors.textSecondary }}>{a.text}</Text> : null}
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{[a.sub, formatBangladeshDateTime(new Date(a.at), language)].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        );
      })}

      <AppConfirmDialog visible={confirm} danger icon="trash-can-outline" title={bn ? 'সব অ্যালার্টের তালিকা মুছবেন?' : 'Clear the alert list?'} description={bn ? 'শুধু এই তালিকা মুছবে। বার্তাগুলো যেমন আছে তেমনই থাকবে।' : 'Only this list is cleared. Your messages stay as they are.'}
        cancelLabel={bn ? 'না' : 'No'} confirmLabel={bn ? 'মুছুন' : 'Clear'} onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); const ok = clearAlertHistory(); load(); showSnackbar(ok ? (bn ? 'মোছা হয়েছে' : 'Cleared') : (bn ? 'মোছা যায়নি' : 'Could not clear'), ok ? 'success' : 'info'); }} />
    </Page>
  );
}
