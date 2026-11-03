import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { useSQLiteContext } from 'expo-sqlite';
import { unfinishedLoadAt } from '../ai/model/llama-runtime';
import { llmIssueCopy, onLlmIssue, setLlmHealthLanguage, type LlmIssueKind } from '../ai/model/llm-health';
import { border, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

/**
 * The AI's trouble, said the moment it happens, in plain words, with what to do
 * (llm-health.ts). On আপন and on the AI model page. "বুঝেছি" puts it away.
 */
export function LlmIssueCard({ showKilled = true, hideTimeout = false, resetKey }: {
  showKilled?: boolean;
  /** On আপন's page a late AI is already said on the answer itself ("সাধারণ উত্তর — …"), so the
   *  card would say it twice, beside an answer that did come (beta test, 2026-09-27). */
  hideTimeout?: boolean;
  /** A new question clears the last one's notice — it never stays beside a newer answer. */
  resetKey?: string | number;
}) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  // Opened after Android closed the app mid-load: that is said first (the AI model page
  // has its own card for this, so it passes showKilled={false}).
  const db = useSQLiteContext();
  const [kind, setKind] = useState<LlmIssueKind | null>(null);
  // Once put away, the notice about one unfinished load is not shown again (rc.14 review R1);
  // a new one shows as before.
  const crashAt = showKilled ? unfinishedLoadAt() : null;
  useEffect(() => {
    if (!crashAt) return;
    let alive = true;
    void db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', DISMISSED_KEY)
      .then((row) => { if (alive && row?.value !== crashAt) setKind((k) => k ?? 'KILLED'); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [db, crashAt]);
  const dismiss = () => {
    if (kind === 'KILLED' && crashAt) void db.runAsync('INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)', DISMISSED_KEY, crashAt).catch(() => undefined);
    setKind(null);
  };

  useEffect(() => { setLlmHealthLanguage(bn ? 'bn' : 'en'); }, [bn]);
  // A slow reply that did come is no failure either: "AI আজ ধীরে চলছে" sat beside a
  // "✨ AI দিয়ে লেখা" answer. "AI ধীর কেন?" still tells it (lastLlmIssue).
  useEffect(() => onLlmIssue((issue) => {
    if (hideTimeout && issue.kind === 'SLOW') return;
    if (!(hideTimeout && issue.kind === 'TIMEOUT')) setKind(issue.kind);
  }), [hideTimeout]);
  // Adjusting state while rendering (React's pattern for "reset when a prop changes"): no effect,
  // no flash of the old notice. The app-closed notice stays until it is put away.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) { setSeenKey(resetKey); if (kind && kind !== 'KILLED') setKind(null); }

  if (!kind) return null;
  const copy = llmIssueCopy(kind, bn);
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <View style={styles.head}>
        <AppIcon name="alert-circle-outline" size={22} color={accents.yellow.on} />
        <Text style={styles.title}>{copy.title}</Text>
      </View>
      <Text style={styles.body}>{copy.body}</Text>
      <Text style={styles.what}>{bn ? 'কী করবেন:' : 'What to do:'}</Text>
      {copy.steps.map((step, i) => (
        <View key={i} style={styles.step}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.stepText}>{step}</Text>
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={dismiss} style={({ pressed }) => StyleSheet.flatten([styles.ok, pressed && styles.pressed])}>
        <Text style={styles.okText}>{bn ? 'বুঝেছি' : 'Got it'}</Text>
      </Pressable>
    </View>
  );
}

const DISMISSED_KEY = 'llm.killedNotice.dismissedFor';

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    card: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: accents.yellow.border, backgroundColor: accents.yellow.soft, gap: spacing.xs },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { flex: 1, ...typography.callout, fontWeight: '700', color: colors.textPrimary },
    body: { ...typography.bodySmall, color: colors.textSecondary },
    what: { ...typography.label, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xxs },
    step: { flexDirection: 'row', gap: spacing.xs },
    bullet: { ...typography.bodySmall, color: colors.textPrimary },
    stepText: { flex: 1, ...typography.bodySmall, color: colors.textPrimary },
    ok: { alignSelf: 'flex-end', minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
    okText: { ...typography.meta, fontWeight: '700', color: colors.onPrimary },
    banner: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 60, elevation: 16, padding: spacing.smd, borderRadius: radius.lg, borderWidth: border.thin, borderColor: accents.yellow.border, backgroundColor: colors.surface, gap: spacing.xs },
    bannerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
    more: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    moreText: { ...typography.meta, fontWeight: '700', color: colors.primary },
    pressed: { opacity: 0.75 },
  });
}

/**
 * The same trouble, shown at the top of whatever page is open (the user's request: tell
 * them at once). আপন and the AI model page carry the full card instead, so this stays off
 * there. "বিস্তারিত" opens the steps in place; "বুঝেছি" puts it away.
 */
export function LlmIssueBanner({ hidden }: { hidden: boolean }) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const [kind, setKind] = useState<LlmIssueKind | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setLlmHealthLanguage(bn ? 'bn' : 'en'); }, [bn]);
  // A late AI always comes with আপন's own answer, so it is no failure to announce on another
  // page later (it stayed as a stale banner — beta test 2026-09-27); "AI ধীর কেন?" still tells it.
  // Slow is the same: said on আপন's answer, never later elsewhere. And what happens while the
  // banner is hidden (on আপন, which has its own card) is not kept to pop up stale on leaving.
  const hiddenRef = useRef(hidden);
  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);
  useEffect(() => onLlmIssue((issue) => {
    if (issue.kind === 'TIMEOUT') return;
    if (issue.kind === 'SLOW' || hiddenRef.current) return;
    setKind(issue.kind); setOpen(false);
  }), []);
  if (!kind || hidden) return null;
  const copy = llmIssueCopy(kind, bn);
  return (
    <View style={[styles.banner, { top: insets.top + spacing.xs }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <View style={styles.head}>
        <AppIcon name="alert-circle-outline" size={20} color={accents.yellow.on} />
        <Text style={styles.title}>{copy.title}</Text>
      </View>
      {open ? (
        <>
          <Text style={styles.body}>{copy.body}</Text>
          {copy.steps.map((step, i) => (
            <View key={i} style={styles.step}><Text style={styles.bullet}>•</Text><Text style={styles.stepText}>{step}</Text></View>
          ))}
        </>
      ) : null}
      <View style={styles.bannerRow}>
        {!open ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => StyleSheet.flatten([styles.more, pressed && styles.pressed])}>
            <Text style={styles.moreText}>{bn ? 'কী করবেন' : 'What to do'}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setKind(null)} style={({ pressed }) => StyleSheet.flatten([styles.ok, pressed && styles.pressed])}>
          <Text style={styles.okText}>{bn ? 'বুঝেছি' : 'Got it'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
