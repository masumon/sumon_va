// স্বাস্থ্যের ইতিহাস — one timeline, every kind of record on it.
//
// Separate lists for medicines, visits, tests and costs are four screens that each answer
// half a question. What a person actually asks is "what happened in March" — so the
// records are merged into one date-ordered stream, and the filter narrows it rather than
// navigating away from it.

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppText as Text, AppTextInput as TextInput } from '../../src/ui/AppText';
import { AppIcon } from '../../src/ui/AppIcon';
import { Chip, EmptyNote, ScreenHeader, useKit } from '../../src/ui/AppKit';
import { formatPaisa } from '../../src/services/debt/money';
import {
  healthCategoryName, listDoses, listMedicalEntries, listMedicines, listPrescriptions,
  listTests, listVisits,
} from '../../src/services/health-service';
import { border, icon as iconSize, radius, spacing, typography, type ThemeColors } from '../../src/theme';
import { tapLight } from '../../src/ui/haptics';
import { formatDayKey } from '../../src/i18n/date-time';

type Kind = 'ALL' | 'MEDICINE' | 'VISIT' | 'TEST' | 'COST' | 'DOSE' | 'RX';

interface Item {
  id: string;
  kind: Exclude<Kind, 'ALL'>;
  day: string;
  title: string;
  subtitle: string;
  amountPaisa?: number;
  route?: string;
  icon: string;
}

const ICON: Record<Exclude<Kind, 'ALL'>, string> = {
  MEDICINE: 'pill', VISIT: 'stethoscope', TEST: 'test-tube',
  COST: 'medical-bag', DOSE: 'check-circle-outline', RX: 'file-document-outline',
};

export default function HealthHistoryScreen() {
  const db = useSQLiteContext();
  const { colors, accents, bn } = useKit();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<Kind>('ALL');
  const [query, setQuery] = useState('');

  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: bn }), [bn]);

  const load = useCallback(async () => {
    const [medicines, visits, tests, costs, prescriptions] = await Promise.all([
      listMedicines(db, { includeArchived: true }),
      listVisits(db, { limit: 200 }),
      listTests(db, { limit: 200 }),
      listMedicalEntries(db, 200),
      listPrescriptions(db, 100),
    ]);

    const out: Item[] = [];

    for (const m of medicines) {
      out.push({
        id: `med-${m.id}`, kind: 'MEDICINE', day: (m.startDate ?? m.purchasedOn ?? '').slice(0, 10),
        title: m.name, icon: ICON.MEDICINE, route: `/health/medicine/${m.id}`,
        subtitle: [m.reason, m.archivedAt ? (bn ? 'বন্ধ' : 'stopped') : (bn ? 'চলছে' : 'ongoing')].filter(Boolean).join(' · '),
      });
    }
    for (const v of visits) {
      out.push({
        id: `visit-${v.id}`, kind: 'VISIT', day: v.visitedOn, title: v.doctor,
        subtitle: [v.specialty, v.diagnosis].filter(Boolean).join(' · ') || (bn ? 'ডাক্তার দেখানো' : 'Doctor visit'),
        amountPaisa: v.feePaisa + v.extraPaisa, icon: ICON.VISIT, route: '/health/visits',
      });
    }
    for (const t of tests) {
      out.push({
        id: `test-${t.id}`, kind: 'TEST', day: t.testedOn, title: t.name,
        subtitle: [t.lab, t.result].filter(Boolean).join(' · ') || (bn ? 'পরীক্ষা' : 'Test'),
        amountPaisa: t.costPaisa, icon: ICON.TEST, route: '/health/tests',
      });
    }
    for (const c of costs) {
      out.push({
        id: `cost-${c.id}`, kind: 'COST', day: c.occurredAt.slice(0, 10),
        title: c.note || healthCategoryName(c.category, bn),
        subtitle: healthCategoryName(c.category, bn), amountPaisa: c.amountPaisa,
        icon: ICON.COST, route: '/health/expenses',
      });
    }
    for (const p of prescriptions) {
      out.push({
        id: `rx-${p.id}`, kind: 'RX', day: (p.issuedOn ?? '').slice(0, 10),
        title: p.diagnosis || (bn ? 'প্রেসক্রিপশন' : 'Prescription'),
        subtitle: [p.doctor, p.advice].filter(Boolean).join(' · '), icon: ICON.RX, route: '/health/prescriptions',
      });
    }

    // Doses over the last fortnight — the "did I actually take it" half of the history.
    for (let back = 0; back < 14; back += 1) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      const dayKey = d.toISOString().slice(0, 10);
      for (const dose of await listDoses(db, dayKey)) {
        if (dose.status === 'PENDING') continue;
        out.push({
          id: `dose-${dose.id}`, kind: 'DOSE', day: dose.dayKey,
          title: dose.medicineName ?? (bn ? 'ওষুধ' : 'Medicine'),
          subtitle: dose.status === 'TAKEN' ? (bn ? 'খেয়েছেন' : 'taken') : (bn ? 'বাদ পড়েছে' : 'skipped'),
          icon: ICON.DOSE, route: '/health',
        });
      }
    }

    out.sort((a, b) => b.day.localeCompare(a.day));
    setItems(out);
  }, [db, bn]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'ALL' && item.kind !== kind) return false;
      if (!term) return true;
      return item.title.toLowerCase().includes(term)
        || item.subtitle.toLowerCase().includes(term)
        || item.day.includes(term);
    });
  }, [items, kind, query]);

  const KINDS: Kind[] = ['ALL', 'MEDICINE', 'VISIT', 'TEST', 'COST', 'DOSE', 'RX'];
  const kindLabel = (k: Kind) => (bn
    ? { ALL: 'সব', MEDICINE: 'ওষুধ', VISIT: 'ডাক্তার', TEST: 'পরীক্ষা', COST: 'খরচ', DOSE: 'ডোজ', RX: 'প্রেসক্রিপশন' }[k]
    : { ALL: 'All', MEDICINE: 'Medicine', VISIT: 'Doctor', TEST: 'Test', COST: 'Cost', DOSE: 'Dose', RX: 'Rx' }[k]);

  return (
    <View style={s.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title={bn ? 'স্বাস্থ্যের ইতিহাস' : 'Health history'}
          subtitle={bn ? 'যা যা হয়েছে, তারিখ ধরে' : 'Everything that happened, by date'}
          backTo="/health"
          backLabel={bn ? 'স্বাস্থ্য' : 'Health'}
        />

        <View style={s.searchBox}>
          <AppIcon name="magnify" size={iconSize.sm} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={bn ? 'নাম, তারিখ বা কারণ খুঁজুন' : 'Search a name, date or reason'}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={bn ? 'ইতিহাস খুঁজুন' : 'Search history'}
            style={s.searchInput}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মুছুন' : 'Clear'} onPress={() => setQuery('')}>
              <AppIcon name="close-circle" size={iconSize.sm} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={s.chipRow}>
          {KINDS.map((k) => (
            <Chip key={k} label={kindLabel(k)} active={kind === k} onPress={() => { tapLight(); setKind(k); }} />
          ))}
        </View>

        {!shown.length ? (
          <EmptyNote
            icon="history"
            text={bn ? 'এই ছাঁকনিতে কিছু নেই।' : 'Nothing matches that filter.'}
          />
        ) : shown.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => { if (item.route) { tapLight(); router.push(item.route as never); } }}
            style={({ pressed }) => StyleSheet.flatten([s.row, pressed && s.pressed])}
          >
            <View style={[s.rowIcon, { backgroundColor: accents.red.soft }]}>
              <AppIcon name={item.icon as never} size={iconSize.sm} color={accents.red.on} />
            </View>
            <View style={s.rowCopy}>
              <Text numberOfLines={1} style={s.rowTitle}>{item.title}</Text>
              <Text numberOfLines={1} style={s.rowSub}>
                {[item.day ? formatDayKey(item.day, bn ? 'bn' : 'en') : null, item.subtitle].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {item.amountPaisa ? <Text numberOfLines={1} style={s.rowValue}>{money(item.amountPaisa)}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    searchBox: {
      minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, borderRadius: radius.md,
      borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, color: colors.textPrimary, ...typography.input, paddingVertical: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
    row: {
      minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border,
      borderRadius: radius.lg, padding: spacing.md,
    },
    rowIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    rowSub: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    rowValue: { color: colors.textPrimary, ...typography.meta, fontWeight: '800' },
    pressed: { opacity: 0.7 },
  });
}
