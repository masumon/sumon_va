import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { getPortfolio, type PortfolioView } from '../../src/services/debt/debt-service';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { debtCopy } from '../../src/i18n/debt';
import { AppIcon } from '../../src/ui/AppIcon';
import { AppState, AppSkeletonList } from '../../src/ui/AppSurface';
import { tapSelect } from '../../src/ui/haptics';
import {control, border, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../../src/theme';
import { listPeople } from '../../src/services/debt/repository';
import type { Direction, Person } from '../../src/services/debt/types';
import { RecordPreview } from '../../src/ui/RecordPreview';

type SortKey = 'AMOUNT' | 'DUE' | 'NAME';
const SORTS: SortKey[] = ['AMOUNT', 'DUE', 'NAME'];
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED', 'SETTLED', 'WRITTEN_OFF']);

export default function AccountsList() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ direction?: string }>();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const c = useMemo(() => debtCopy(language), [language]);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const money = (p: number) => formatPaisa(p, { bnDigits: bn });

  const [dir, setDir] = useState<Direction>(params.direction === 'RECEIVABLE' ? 'RECEIVABLE' : 'DEBT');

  const [preview, setPreview] = useState<{ a: (typeof rows)[number]; b: ReturnType<typeof balById.get>; name: string } | null>(null);
  const [view, setView] = useState<PortfolioView | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('AMOUNT');
  // Settled/written-off/cancelled/completed accounts never leave `listAccounts` -- only a
  // soft delete does -- so without this they pile up mixed in with active ones forever,
  // with no way to tell "still owed" from "long since closed" at a glance.
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, p] = await Promise.all([getPortfolio(db), listPeople(db)]);
      setView(v); setPeople(p);
    } catch { setView(null); }
    finally { setReady(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const balById = useMemo(() => new Map((view?.balances ?? []).map((b) => [b.accountId, b])), [view]);
  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  // Filter then sort. Search covers the title, the person's name and the purpose, so
  // "Rahim" and "medical" both find the same account. Status uses the same derived
  // balance status the card's own badge shows, falling back to the raw account status the
  // same way the badge does, so what "closed" filters out matches what it visibly labels.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (view?.accounts ?? []).filter((a) => {
      if (a.direction !== dir) return false;
      if (!showClosed && CLOSED_STATUSES.has(balById.get(a.id)?.status ?? a.status)) return false;
      if (!q) return true;
      const haystack = `${a.title ?? ''} ${nameById.get(a.personId) ?? ''} ${a.purpose ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
    return list.sort((x, y) => {
      const bx = balById.get(x.id);
      const by = balById.get(y.id);
      if (sort === 'AMOUNT') return (by?.remainingPaisa ?? 0) - (bx?.remainingPaisa ?? 0);
      if (sort === 'NAME') return (nameById.get(x.personId) ?? x.title ?? '').localeCompare(nameById.get(y.personId) ?? y.title ?? '');
      // DUE: dated slices first, soonest at the top; undated accounts sink to the bottom.
      const dx = bx?.nextDueDate ?? '9999-12-31';
      const dy = by?.nextDueDate ?? '9999-12-31';
      return dx.localeCompare(dy);
    });
  }, [view, dir, query, sort, showClosed, balById, nameById]);

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/debt'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
        <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{dir === 'DEBT' ? c.myDebts : c.myReceivables}</Text>

      <View style={styles.tabs}>
        {(['DEBT', 'RECEIVABLE'] as const).map((d) => (
          <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: dir === d }} onPress={() => { tapSelect(); setDir(d); }} style={({ pressed }) => StyleSheet.flatten([styles.tab, dir === d && styles.tabOn, pressed && styles.pressed])}>
            <Text numberOfLines={1} style={[styles.tabText, dir === d && styles.tabTextOn]}>{d === 'DEBT' ? c.myDebts : c.myReceivables}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={c.search}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={c.search}
      />
      <View style={styles.sortRow}>
        {SORTS.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: sort === k }}
            onPress={() => { tapSelect(); setSort(k); }}
            style={({ pressed }) => StyleSheet.flatten([styles.sortHit, pressed && styles.pressed])}
          >
            <View style={[styles.sortChip, sort === k && styles.sortChipOn]}>
              <Text style={[styles.sortText, sort === k && styles.sortTextOn]}>
                {k === 'AMOUNT' ? c.amount : k === 'DUE' ? c.date : c.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={styles.sortRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !showClosed }}
          onPress={() => { tapSelect(); setShowClosed((v) => !v); }}
          style={({ pressed }) => StyleSheet.flatten([styles.sortHit, pressed && styles.pressed])}
        >
          <View style={[styles.sortChip, !showClosed && styles.sortChipOn]}>
            <Text style={[styles.sortText, !showClosed && styles.sortTextOn]}>{c.showActiveOnly}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: showClosed }}
          onPress={() => { tapSelect(); setShowClosed((v) => !v); }}
          style={({ pressed }) => StyleSheet.flatten([styles.sortHit, pressed && styles.pressed])}
        >
          <View style={[styles.sortChip, showClosed && styles.sortChipOn]}>
            <Text style={[styles.sortText, showClosed && styles.sortTextOn]}>{c.showAllStatuses}</Text>
          </View>
        </Pressable>
      </View>

      {!ready ? (
        <AppSkeletonList rows={5} />
      ) : rows.length === 0 ? (
        <AppState icon="wallet-outline" title={dir === 'DEBT' ? c.noDebts : c.noReceivables} description={c.noDebtsHint} actionLabel={dir === 'DEBT' ? c.addDebt : c.addReceivable} onAction={() => router.push(`/debt/new?direction=${dir}` as never)} />
      ) : (
        rows.map((a) => {
          const b = balById.get(a.id);
          const tone = a.direction === 'DEBT' ? accents.red : accents.green;
          const total = b?.totalPayablePaisa || 1;
          const pct = Math.min(100, Math.round(((b?.paidPaisa ?? 0) / total) * 100));
          return (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.title || nameById.get(a.personId) || a.id} onPress={() => setPreview({ a, b, name: a.title || nameById.get(a.personId) || (a.direction === 'DEBT' ? c.totalDebt : c.totalReceivable) })} style={({ pressed }) => StyleSheet.flatten([styles.card, pressed && styles.pressed])}>
              <View style={styles.cardTop}>
                <View style={[styles.dot, { backgroundColor: tone.base }]} />
                <Text numberOfLines={1} style={styles.cardTitle}>{a.title || nameById.get(a.personId) || (a.direction === 'DEBT' ? c.totalDebt : c.totalReceivable)}</Text>
                <View style={[styles.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                  <Text style={[styles.badgeText, { color: tone.on }]}>{c.status[b?.status ?? a.status]}</Text>
                </View>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.remaining}>{c.remaining}: <Text style={styles.remainingVal}>{money(b?.remainingPaisa ?? 0)}</Text></Text>
                <Text style={styles.paidVal}>{c.paid} {money(b?.paidPaisa ?? 0)} / {money(b?.totalPayablePaisa ?? 0)}</Text>
              </View>
              <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: tone.base }]} /></View>
              {b?.overduePaisa ? <Text style={styles.overdue}>{c.overdue}: {money(b.overduePaisa)} · {bn ? `${asciiDigitsToBengali(String(b.overdueDays))} দিন` : `${b.overdueDays}d`}</Text> : null}
              {b?.nextDueDate ? <Text style={styles.next}>{bn ? 'পরবর্তী' : 'Next'}: {b.nextDueDate} · {money(b.nextDuePaisa)}</Text> : null}
            </Pressable>
          );
        })
      )}
    {/* Same read-first preview as the health cards; the account page keeps every action. */}
      {preview ? (
        <RecordPreview
          visible
          icon={preview.a.direction === 'DEBT' ? 'arrow-up-bold-circle-outline' : 'arrow-down-bold-circle-outline'}
          title={preview.name}
          subtitle={c.status[preview.b?.status ?? preview.a.status]}
          headline={money(preview.b?.remainingPaisa ?? 0)}
          headlineLabel={c.remaining}
          rows={[
            { label: c.paid, value: `${money(preview.b?.paidPaisa ?? 0)} / ${money(preview.b?.totalPayablePaisa ?? 0)}` },
            { label: c.overdue, value: preview.b?.overduePaisa ? money(preview.b.overduePaisa) : null },
            { label: bn ? 'পরবর্তী কিস্তি' : 'Next due', value: preview.b?.nextDueDate ? `${preview.b.nextDueDate} · ${money(preview.b.nextDuePaisa)}` : null },
          ]}
          editIcon="open-in-new"
          editLabel={bn ? 'খুলুন — লেনদেন, ফাইল, বদলান' : 'Open — payments, files, edit'}
          onEdit={() => { const id = preview.a.id; setPreview(null); router.push(`/debt/account/${id}` as never); }}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.xl },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginBottom: spacing.md },
    tabs: { flexDirection: 'row', gap: spacing.xs, padding: spacing.xxs, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, marginBottom: spacing.md },
    tab: { flex: 1, minHeight: layout.minTouchTarget, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
    tabOn: { backgroundColor: colors.primary },
    tabText: { color: colors.textSecondary, ...typography.meta, fontWeight: '800' },
    tabTextOn: { color: colors.onPrimary },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.soft },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    cardTitle: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800' },
    badge: { borderWidth: border.thin, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    badgeText: { ...typography.caption, fontWeight: '800' },
    amountRow: { marginTop: spacing.sm, gap: 2 },
    remaining: { color: colors.textSecondary, ...typography.caption },
    remainingVal: { color: colors.textPrimary, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    paidVal: { color: colors.textMuted, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: spacing.xs },
    fill: { height: 6, borderRadius: radius.pill },
    overdue: { color: colors.danger, ...typography.caption, fontWeight: '700', marginTop: spacing.xs },
    next: { color: colors.textMuted, ...typography.caption, marginTop: 2 },
    search: { minHeight: control.searchHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input, marginBottom: spacing.sm },
    sortRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
    sortHit: { minHeight: layout.minTouchTarget, justifyContent: 'center' },
    sortChip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    sortChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    sortText: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    sortTextOn: { color: colors.onPrimary },
    pressed: { opacity: 0.78 },
  });
}
