import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppBadge, AppButton } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { Card, useKit } from '../src/ui/AppKit';
import { useAppFeedback } from '../src/ui/AppFeedback';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { Page } from '../src/va/Page';
import { useLoad } from '../src/va/hooks';
import { GROUPS, PERMISSIONS, reasonFor, requestRuntime, type Outcome, type PermDef } from '../src/va/permissions';
import { getStatus, openAppSettings, startService, testAlert } from '../modules/va-bridge';

/** Permission centre: every permission with the phone's own real answer — a tick when it works, and the exact reason when it does not. */
export default function SetupScreen() {
  const { bn, colors, language } = useKit();
  const { showSnackbar } = useAppFeedback();
  const status = useLoad(async () => getStatus(), 'bridge', 2000);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<Record<string, Outcome>>({});
  const s = status.data ?? getStatus();

  const must = PERMISSIONS.filter((p) => p.grade === 'must');
  const mustOk = must.filter((p) => p.ok(s)).length;
  const allOk = PERMISSIONS.filter((p) => p.ok(s)).length;

  const grant = async (def: PermDef) => {
    setBusy(def.key);
    try {
      if (def.runtime) {
        const out = await requestRuntime(def.runtime);
        setLast((m) => ({ ...m, [def.key]: out }));
      } else {
        def.open?.();
        setLast((m) => ({ ...m, [def.key]: { ok: false, reasonBn: '', reasonEn: '' } })); // checked again when the owner comes back
      }
      await status.reload();
    } finally { setBusy(null); }
  };

  const grantAllRuntime = async () => {
    setBusy('all');
    try {
      for (const def of PERMISSIONS.filter((p) => p.runtime && !p.ok(getStatus()))) {
        const out = await requestRuntime(def.runtime!);
        setLast((m) => ({ ...m, [def.key]: out }));
      }
      await status.reload();
      showSnackbar(bn ? 'অনুমতির অবস্থা নিচে দেখুন' : 'See each permission below', 'info');
    } finally { setBusy(null); }
  };

  return (
    <Page title={bn ? 'অনুমতি' : 'Permissions'} subtitle={bn ? `জরুরি ${mustOk}/${must.length} ✓ · মোট ${allOk}/${PERMISSIONS.length}` : `Essential ${mustOk}/${must.length} ✓ · all ${allOk}/${PERMISSIONS.length}`} onRefresh={status.reload} bottomPadding={48}>
      <Card>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round((mustOk / must.length) * 100)}%`, height: 10, backgroundColor: mustOk === must.length ? colors.success : colors.warning }} />
        </View>
        <Text style={{ marginTop: 8 }}>{mustOk === must.length ? (bn ? '✓ সব জরুরি অনুমতি ঠিক আছে।' : '✓ All essential permissions are fine.') : (bn ? 'কিছু জরুরি অনুমতি বাকি — নিচে লাল চিহ্নগুলো ঠিক করুন।' : 'Some essential permissions are missing — fix the red ones below.')}</Text>
        <View style={{ marginTop: 10 }}><AppButton label={bn ? 'সব অনুমতি একসাথে চাই' : 'Ask for all at once'} icon="shield-check-outline" loading={busy === 'all'} onPress={() => void grantAllRuntime()} /></View>
      </Card>

      {GROUPS.map((g) => (
        <View key={g.key} style={{ gap: 10 }}>
          <View style={{ marginTop: 6 }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{bn ? g.bn : g.en}</Text>
            <Text style={{ opacity: 0.65, fontSize: 12 }}>{bn ? g.hintBn : g.hintEn}</Text>
          </View>
          {PERMISSIONS.filter((p) => p.group === g.key).map((def) => {
            const ok = def.ok(s);
            const reason = reasonFor(def, s, last[def.key], bn);
            return (
              <Card key={def.key}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <AppIcon name={ok ? 'check-circle' : def.grade === 'optional' ? 'minus-circle-outline' : 'close-circle'} size={26} color={ok ? colors.success : def.grade === 'optional' ? colors.textMuted : colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{bn ? def.bn : def.en}</Text>
                    <Text style={{ opacity: 0.7, fontSize: 13, lineHeight: 19 }}>{bn ? def.whyBn : def.whyEn}</Text>
                  </View>
                  <AppBadge tone={ok ? 'success' : def.grade === 'optional' ? 'neutral' : 'danger'} label={ok ? (bn ? 'চালু ✓' : 'On ✓') : def.grade === 'optional' ? (bn ? 'ঐচ্ছিক' : 'Optional') : (bn ? 'বাকি' : 'Missing')} />
                </View>
                {reason ? (
                  <View style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surfaceMuted }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>{bn ? 'কেন হয়নি' : 'Why it failed'}</Text>
                    <Text style={{ fontSize: 13, lineHeight: 19 }}>{reason}</Text>
                  </View>
                ) : null}
                {!ok ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <AppButton label={def.runtime ? (bn ? 'অনুমতি দিন' : 'Allow') : (bn ? 'সেটিংসে চালু করুন' : 'Turn on in Settings')} loading={busy === def.key} onPress={() => void grant(def)} />
                    {reason ? <AppButton variant="secondary" label={bn ? 'অ্যাপ-তথ্য খুলুন' : 'Open app info'} onPress={() => { openAppSettings(); }} /> : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      ))}

      <Card title={bn ? 'সংযোগের অবস্থা' : 'Connection health'}>
        <Text>{bn ? 'ব্যাকগ্রাউন্ড সিঙ্ক: ' : 'Background sync: '}{s.serviceAlive ? (bn ? 'চালু ✓' : 'running ✓') : (bn ? 'বন্ধ' : 'stopped')}</Text>
        <Text>{bn ? 'শেষ সফল সংযোগ: ' : 'Last successful sync: '}{s.lastOk ? formatBangladeshDateTime(new Date(s.lastOk), language) : (bn ? 'এখনও হয়নি' : 'not yet')}</Text>
        <Text>{bn ? 'পাঠানোর অপেক্ষায় (অফলাইন): ' : 'Waiting to upload (offline): '}{s.queued}</Text>
        {s.lastError ? <Text style={{ color: colors.danger }}>{s.lastError}</Text> : null}
        <View style={{ gap: 8, marginTop: 10 }}>
          <AppButton variant="secondary" icon="sync" label={bn ? 'সিঙ্ক আবার চালু করুন' : 'Restart sync'} onPress={() => { startService(); void status.reload(); }} />
          <AppButton variant="secondary" icon="bell-ring-outline" label={bn ? 'জরুরি অ্যালার্ম পরীক্ষা (সাইলেন্টে রেখে চাপুন)' : 'Test urgent alarm (press while on silent)'} onPress={() => { testAlert(); showSnackbar(bn ? 'অ্যালার্ম পাঠানো হয়েছে' : 'Alarm sent', 'info'); }} />
        </View>
      </Card>
      <AppButton label={bn ? 'শেষ — হোমে যাই' : 'Done — go Home'} icon="home-variant" onPress={() => { startService(); router.replace('/' as never); }} />
    </Page>
  );
}
