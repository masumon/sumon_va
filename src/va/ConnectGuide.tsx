import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../ui/AppText';
import { AppBadge, AppButton } from '../ui/AppSurface';
import { AppIcon } from '../ui/AppIcon';
import { Card, useKit } from '../ui/AppKit';
import { useAppFeedback } from '../ui/AppFeedback';
import { getStatus, isInstalled } from '../../modules/va-bridge';
import { va, type ChannelsInfo } from './api';
import { computeChecks, guideFor, verdict } from './connect';
import type { ModuleDef } from './modules';

const WAIT_S = 90;

/**
 * Connect a platform with no code: the steps in plain words, a live tick for every step, and a test that waits for a real message.
 * Success = a message from this platform actually reached the inbox. Failure names the step that is missing.
 */
export function ConnectGuide({ mod, channels, received, pending = false, onTested }: { mod: ModuleDef; channels: ChannelsInfo | null; received: number; pending?: boolean; onTested: () => void }) {
  const { bn, colors } = useKit();
  const { showSnackbar } = useAppFeedback();
  const [bridge, setBridge] = useState(getStatus());
  const [testing, setTesting] = useState(false);
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<{ total: number; time: number } | null>(null);

  // The phone's own state is re-read every few seconds so the ticks turn green as soon as a permission is granted.
  useEffect(() => { const id = setInterval(() => setBridge(getStatus()), 3000); return () => clearInterval(id); }, []);

  const checks = computeChecks(mod, { bridge, channels, received, installed: isInstalled });
  const v = verdict(checks);
  const guide = guideFor(mod);

  // The test: watch the inbox for this platform; a new person or a new message from it means success.
  useEffect(() => {
    if (!testing || !baseline) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await va.contacts('all', '', 1, mod.sources);
        const newest = Math.max(0, ...r.items.map((c) => (c.last_message_at ? Date.parse(c.last_message_at) : 0)));
        if (!stop && (r.total > baseline.total || newest > baseline.time)) { setTesting(false); setResult('ok'); onTested(); showSnackbar(bn ? 'সংযোগ ঠিক আছে ✓ বার্তা এসেছে' : 'Connected ✓ — a message arrived', 'success'); return; }
      } catch { /* keep waiting: a short network blip is not a failed test */ }
      if (!stop) setLeft((n) => { if (n <= 1) { setTesting(false); setResult('fail'); return 0; } return n - 1; });
    };
    const id = setInterval(() => { void tick(); }, 3000);
    return () => { stop = true; clearInterval(id); };
  }, [testing, baseline, mod.sources, onTested, showSnackbar, bn]);

  const start = async () => {
    setResult(null);
    let base = { total: received, time: Date.now() };
    try {
      const r = await va.contacts('all', '', 1, mod.sources);
      base = { total: r.total, time: Math.max(0, ...r.items.map((c) => (c.last_message_at ? Date.parse(c.last_message_at) : 0))) };
    } catch { /* use what we already know */ }
    setBaseline(base);
    setLeft(Math.round(WAIT_S / 3));
    setTesting(true);
  };

  const missing = checks.filter((c) => !c.ok && c.key !== 'received');
  const tone = v === 'ok' ? 'success' : v === 'partial' ? 'warning' : 'danger';
  const label = v === 'ok' ? (bn ? 'সংযোগ ঠিক আছে ✓' : 'Connected ✓') : v === 'partial' ? (bn ? 'প্রায় হয়ে গেছে, পরীক্ষা বাকি' : 'Almost — test pending') : (bn ? 'সংযোগ হয়নি' : 'Not connected');

  // Already working: one calm line, details one tap away. The full checklist appears again by itself if something breaks.
  if (!pending && v === 'ok' && !open && !testing) {
    return (
      <Card>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
          <AppIcon name="check-circle" size={24} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{bn ? 'সংযোগ ঠিক আছে ✓' : 'Connected ✓'}</Text>
            <Text style={{ opacity: 0.7, fontSize: 12 }}>{bn ? 'বার্তা আসছে। বিস্তারিত ও পরীক্ষা দেখতে চাপুন।' : 'Messages are arriving. Tap for details and a test.'}</Text>
          </View>
          <AppIcon name="chevron-down" size={22} color={colors.textMuted} />
        </Pressable>
      </Card>
    );
  }

  return (
    <Card title={bn ? 'সংযোগ করুন' : 'Connect'}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AppBadge tone={pending ? 'neutral' : tone} label={pending ? (bn ? 'দেখছি…' : 'Checking…') : label} />
      </View>
      {checks.map((c) => (
        <View key={c.key} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6, alignItems: 'flex-start' }}>
          <AppIcon name={pending && !c.ok ? 'progress-clock' : c.ok ? 'check-circle' : 'close-circle-outline'} size={22} color={pending && !c.ok ? colors.textMuted : c.ok ? colors.success : c.key === 'received' || c.key === 'battery' ? colors.warning : colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{bn ? c.bn : c.en}</Text>
            <Text style={{ opacity: 0.7, fontSize: 12 }}>{bn ? c.hintBn : c.hintEn}</Text>
            {!c.ok && c.fix ? <View style={{ alignSelf: 'flex-start', marginTop: 4 }}><AppButton variant="secondary" label={bn ? c.fix.bn : c.fix.en} onPress={() => router.push(c.fix!.route as never)} /></View> : null}
          </View>
        </View>
      ))}

      <View style={{ marginTop: 10, gap: 8 }}>
        <AppButton label={testing ? (bn ? `অপেক্ষা করছি… (${left * 3}s)` : `Waiting… (${left * 3}s)`) : (bn ? 'সংযোগ পরীক্ষা করুন' : 'Test connection')} icon="radar" loading={testing} onPress={() => void start()} />
        {testing ? <Text style={{ opacity: 0.8, lineHeight: 21 }}>{bn ? `এখন অন্য কোনো ফোন বা অ্যাকাউন্ট থেকে ${mod.bn}-এ আপনাকে একটা বার্তা পাঠাতে বলুন।` : `Now ask someone to send you a message on ${mod.en} from another phone/account.`}</Text> : null}
        {result === 'ok' ? <Text style={{ color: colors.success, fontWeight: '700' }}>{bn ? '✓ ঠিক আছে। বার্তা ইনবক্সে পৌঁছেছে।' : '✓ Success — the message reached the inbox.'}</Text> : null}
        {result === 'fail' ? (
          <View style={{ padding: 10, borderRadius: 10, backgroundColor: colors.surfaceMuted }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>{bn ? '⚠ কোনো বার্তা আসেনি' : '✗ Failed — no message arrived'}</Text>
            <Text style={{ marginTop: 4, lineHeight: 21 }}>
              {missing.length ? (bn ? `আগে এগুলো ঠিক করুন: ${missing.map((m) => m.bn).join(', ')}` : `Fix these first: ${missing.map((m) => m.en).join(', ')}`)
                : (bn ? 'সব ধাপ ঠিক আছে, তবু বার্তা আসেনি। হতে পারে ওই অ্যাপে নোটিফিকেশন বন্ধ, ফোন “ডোন্ট ডিস্টার্ব” মোডে আছে, অথবা চ্যাটটা মিউট করা। আরেকবার পরীক্ষা করুন।' : 'All steps look fine, yet nothing came. Likely causes: message notifications are off in that app, the phone is in Do Not Disturb, or the chat is muted. Try again.')}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: 12 }}>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>{bn ? 'ধাপে ধাপে করুন' : 'Step by step'}</Text>
        {(bn ? guide.stepsBn : guide.stepsEn).map((st, i) => (
          <View key={st} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '800', fontSize: 12, color: colors.primary }}>{i + 1}</Text></View>
            <Text style={{ flex: 1, lineHeight: 21 }}>{st}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
