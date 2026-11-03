import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../src/app/AppPreferences';
import { useTaskStore } from '../src/store/task.store';
import type { Task } from '../src/types/task-model';
import { AppIcon } from '../src/ui/AppIcon';
import { AppState } from '../src/ui/AppSurface';
import { success, tapLight, tapSelect } from '../src/ui/haptics';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../src/theme';
import { asciiDigitsToBengali } from '../src/services/debt/money';

const PRESETS = [15, 25, 50] as const;
const CLOSED = new Set(['COMPLETED', 'CANCELLED', 'ARCHIVED']);

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FocusScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const toBnDigits = (v: string | number) => String(v).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { tasks, load, complete } = useTaskStore();

  const [minutes, setMinutes] = useState<number>(25);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [left, setLeft] = useState<number>(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const leftRef = useRef(left);
  useEffect(() => { leftRef.current = left; }, [left]);

  useEffect(() => { void load(db); }, [db, load]);

  const open = useMemo<Task[]>(
    () => tasks
      .filter((t) => !CLOSED.has(t.status))
      .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity))
      .slice(0, 12),
    [tasks],
  );
  const focusTask = open.find((t) => t.id === taskId) ?? null;

  // One interval, alive only while running. All the state changes happen inside the
  // timer callback (an external-system callback, not the effect body) — including the
  // hand-off to the "finished" state when the countdown reaches zero.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (leftRef.current <= 1) {
        clearInterval(id);
        setLeft(0);
        setRunning(false);
        setFinished(true);
        success();
      } else {
        setLeft(leftRef.current - 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const reset = useCallback((mins: number) => {
    setRunning(false);
    setFinished(false);
    setLeft(mins * 60);
  }, []);

  const pickPreset = (mins: number) => { tapSelect(); setMinutes(mins); reset(mins); };
  const toggle = () => {
    if (finished) { reset(minutes); return; }
    tapLight();
    setRunning((r) => !r);
  };
  const markDone = async () => {
    if (focusTask) { await complete(db, focusTask.id); }
    reset(minutes);
    setTaskId(null);
  };

  const c = bn
    ? { back: 'আরও', eyebrow: 'ফোকাস', title: 'ফোকাস মোড', sub: 'একটা কাজ বেছে নিন, টাইমার চালু করুন, বাকি সব চুপ।', pick: 'কোন কাজে মন দেবেন?', noTasks: 'খোলা কোনো কাজ নেই', change: 'কাজ বদলান', start: 'শুরু', pause: 'বিরতি', resume: 'চালিয়ে যান', again: 'আরেক দফা', done: 'কাজটি শেষ', doneSub: 'এক দফা শেষ! ভালো লাগলে কাজটি সম্পন্ন চিহ্নিত করুন।', free: 'কাজ ছাড়াই' }
    : { back: 'More', eyebrow: 'FOCUS', title: 'Focus mode', sub: 'Pick one task, start the timer, let everything else go quiet.', pick: 'What are you focusing on?', noTasks: 'No open tasks', change: 'Change task', start: 'Start', pause: 'Pause', resume: 'Resume', again: 'Another round', done: 'Session complete', doneSub: 'One round done. Mark the task complete if it’s finished.', free: 'Free session' };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{c.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{c.title}</Text>
        <Text style={styles.sub}>{c.sub}</Text>
      </View>

      <View style={styles.dial}>
        <Text style={styles.time}>{bn ? asciiDigitsToBengali(mmss(left)) : mmss(left)}</Text>
        <Text style={styles.dialLabel}>{finished ? c.done : focusTask ? focusTask.title : c.free}</Text>
      </View>

      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: minutes === p }} disabled={running} onPress={() => pickPreset(p)} style={({ pressed }) => StyleSheet.flatten([styles.preset, minutes === p && styles.presetOn, running && styles.disabled, pressed && styles.pressed])}>
            <Text style={[styles.presetText, minutes === p && styles.presetTextOn]}>{bn ? `${toBnDigits(p)} মি.` : `${p}m`}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable accessibilityRole="button" onPress={toggle} style={({ pressed }) => StyleSheet.flatten([styles.primary, pressed && styles.pressed])}>
        <AppIcon name={finished ? 'refresh' : running ? 'pause' : 'play'} size={icon.sm} color={colors.onPrimary} />
        <Text style={styles.primaryText}>{finished ? c.again : running ? c.pause : left < minutes * 60 ? c.resume : c.start}</Text>
      </Pressable>

      {finished ? (
        <View style={styles.doneCard}>
          <Text style={styles.doneSub}>{c.doneSub}</Text>
          {focusTask ? (
            <Pressable accessibilityRole="button" onPress={() => void markDone()} style={({ pressed }) => StyleSheet.flatten([styles.ghost, pressed && styles.pressed])}>
              <AppIcon name="check" size={icon.sm} color={colors.primary} /><Text style={styles.ghostText}>{bn ? 'কাজটি সম্পন্ন' : 'Mark task complete'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.pickWrap}>
        <Text style={styles.pickTitle}>{focusTask ? c.change : c.pick}</Text>
        {open.length === 0 ? (
          <AppState icon="checkbox-marked-circle-outline" title={c.noTasks} />
        ) : (
          open.map((t) => {
            const on = t.id === taskId;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                disabled={running}
                onPress={() => { tapSelect(); setTaskId(on ? null : t.id); }}
                style={({ pressed }) => StyleSheet.flatten([styles.taskRow, on && styles.taskRowOn, running && styles.disabled, pressed && styles.pressed])}
              >
                <AppIcon name={on ? 'target' : 'circle-outline'} size={icon.sm} color={on ? colors.primary : colors.textMuted} />
                <Text numberOfLines={2} style={[styles.taskText, on && styles.taskTextOn]}>{t.title}</Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.md },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xs },
    sub: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs },
    dial: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, marginTop: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface, ...elevation.soft },
    time: { color: colors.textPrimary, fontSize: 64, lineHeight: 72, fontWeight: '800', fontFamily: typography.numeric.fontFamily, fontVariant: ['tabular-nums'] },
    dialLabel: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },
    presets: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    preset: { flex: 1, minHeight: layout.minTouchTarget, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    presetOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    presetText: { color: colors.textSecondary, ...typography.callout, fontWeight: '800' },
    presetTextOn: { color: colors.onPrimary },
    primary: { minHeight: control.buttonHeight, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, ...elevation.raised },
    primaryText: { color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    doneCard: { marginTop: spacing.md, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
    doneSub: { color: colors.textSecondary, ...typography.bodySmall },
    ghost: { minHeight: control.buttonHeight, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    ghostText: { color: colors.primary, ...typography.callout, fontWeight: '800' },
    pickWrap: { marginTop: spacing.lg, gap: spacing.xs },
    pickTitle: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.xs },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    taskRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
    taskText: { flex: 1, minWidth: 0, color: colors.textSecondary, ...typography.bodySmall },
    taskTextOn: { color: colors.textPrimary, fontWeight: '700' },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
