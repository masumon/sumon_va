import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../src/app/AppPreferences';
import { listAllMemories } from '../src/services/memory-repository';
import type { Memory } from '../src/types/memory-model';
import { AppIcon } from '../src/ui/AppIcon';
import { AppState } from '../src/ui/AppSurface';
import { bangladeshDateKey, formatBangladeshDate } from '../src/i18n/date-time';
import { border, elevation, icon, layout, radius, spacing, typography, memoryKindIcon, type ThemeAccents, type ThemeColors } from '../src/theme';

type YearGroup = { year: number; items: Memory[] };

export default function OnThisDayScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const [all, setAll] = useState<Memory[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void listAllMemories(db)
      .then((rows) => { if (alive) setAll(rows); })
      .catch(() => { /* keep empty */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [db]);

  const groups = useMemo<YearGroup[]>(() => {
    const [ty, tm, td] = bangladeshDateKey(new Date()).split('-');
    const todayYear = Number(ty);
    const byYear = new Map<number, Memory[]>();
    for (const m of all) {
      const [y, mo, d] = bangladeshDateKey(m.createdAt).split('-');
      if (mo !== tm || d !== td || Number(y) >= todayYear) continue;
      const list = byYear.get(Number(y)) ?? [];
      list.push(m);
      byYear.set(Number(y), list);
    }
    return [...byYear.entries()]
      .map(([year, items]) => ({ year, items }))
      .sort((a, b) => b.year - a.year);
  }, [all]);

  const todayLabel = formatBangladeshDate(new Date(), language).replace(/,?\s*[\d০-৯]{4}$/u, '');
  const c = bn
    ? { back: 'আরও', eyebrow: 'এই দিনে', title: 'এই দিনে', none: 'আগের কোনো বছরে আজকের দিনে কিছু লেখা হয়নি — আজ যা লিখবেন, আগামী বছর এই দিনে এখানে ফিরে দেখাবে', yearsAgo: (n: number) => `${n} বছর আগে` }
    : { back: 'More', eyebrow: 'ON THIS DAY', title: 'On this day', none: 'Nothing was written on this day in an earlier year', yearsAgo: (n: number) => (n === 1 ? '1 year ago' : `${n} years ago`) };
  const nowYear = Number(bangladeshDateKey(new Date()).split('-')[0]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{c.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{c.title}</Text>
        <Text style={styles.sub}>{todayLabel}</Text>
      </View>

      {!ready ? null : groups.length === 0 ? (
        <AppState icon="calendar-blank-outline" title={c.none} />
      ) : (
        groups.map((g) => (
          <View key={g.year} style={styles.group}>
            <Text style={styles.groupHead}>{g.year} · {c.yearsAgo(nowYear - g.year)}</Text>
            {g.items.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={(m.title || m.content).slice(0, 60)}
                onPress={() => router.push({ pathname: '/memory-detail', params: { id: m.id } })}
                style={({ pressed }) => StyleSheet.flatten([styles.card, pressed && styles.pressed])}
              >
                <AppIcon name={memoryKindIcon(m.kind)} size={icon.sm} color={colors.textMuted} />
                <Text numberOfLines={3} style={styles.cardText}>{m.title || m.content}</Text>
                <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ))
      )}
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
    group: { marginBottom: spacing.lg },
    groupHead: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
    card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.soft },
    cardText: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall },
    pressed: { opacity: 0.78 },
  });
}
