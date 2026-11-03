import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput, AppTextInput as SearchInput } from '../../src/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppPreferences } from '../../src/app/AppPreferences';
import { useAppFeedback } from '../../src/ui/AppFeedback';
import { createPerson, listPeople } from '../../src/services/debt/repository';
import { getPortfolio, type PortfolioView } from '../../src/services/debt/debt-service';
import { pickContact, describeContactDenial } from '../../src/services/capture/contacts';
import type { Person } from '../../src/services/debt/types';
import { asciiDigitsToBengali, formatPaisa } from '../../src/services/debt/money';
import { debtCopy } from '../../src/i18n/debt';
import { AppIcon } from '../../src/ui/AppIcon';
import { AppState } from '../../src/ui/AppSurface';
import { success, warn } from '../../src/ui/haptics';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../../src/theme';
import { logAppError } from '../../src/services/error-log';

export default function PeopleScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const c = useMemo(() => debtCopy(language), [language]);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { showSnackbar } = useAppFeedback();

  const [people, setPeople] = useState<Person[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioView | null>(null);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pf] = await Promise.all([listPeople(db), getPortfolio(db)]);
      setPeople(p); setPortfolio(pf);
    } catch { setPeople([]); }
    finally { setReady(true); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Net position per person: what is still owed to them, and what they still owe. */
  const statByPerson = useMemo(() => {
    const m = new Map<string, { debt: number; recv: number; owePaisa: number; owedPaisa: number; overdue: boolean }>();
    const balById = new Map((portfolio?.balances ?? []).map((b) => [b.accountId, b]));
    for (const a of portfolio?.accounts ?? []) {
      const e = m.get(a.personId) ?? { debt: 0, recv: 0, owePaisa: 0, owedPaisa: 0, overdue: false };
      const b = balById.get(a.id);
      if (a.direction === 'DEBT') { e.debt += 1; e.owePaisa += b?.remainingPaisa ?? 0; }
      else { e.recv += 1; e.owedPaisa += b?.remainingPaisa ?? 0; }
      if ((b?.overduePaisa ?? 0) > 0) e.overdue = true;
      m.set(a.personId, e);
    }
    return m;
  }, [portfolio]);

  const money = useCallback((v: number) => formatPaisa(v, { bnDigits: bn }), [bn]);

  // Search covers phone as well as name, because that is how you find someone whose
  // name you spelled differently the first time.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? people.filter((p) => `${p.name} ${p.phone ?? ''}`.toLowerCase().includes(q))
      : people;
    return [...list].sort((x, y) => {
      const sx = statByPerson.get(x.id);
      const sy = statByPerson.get(y.id);
      const tx = (sx?.owePaisa ?? 0) + (sx?.owedPaisa ?? 0);
      const ty = (sy?.owePaisa ?? 0) + (sy?.owedPaisa ?? 0);
      if (tx !== ty) return ty - tx;
      return x.name.localeCompare(y.name);
    });
  }, [people, query, statByPerson]);

  const addFromContacts = async () => {
    setImporting(true);
    try {
      const r = await pickContact();
      if (r.status === 'picked') {
        await createPerson(db, { name: r.contact.name, phone: r.contact.phone });
        success();
        await load();
      } else if (r.status === 'denied') {
        warn();
        const info = describeContactDenial(bn, r.blocked);
        showSnackbar(info.message, 'danger', info.action);
      }
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/people', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setImporting(false); }
  };

  const add = async () => {
    const n = name.trim();
    if (!n || adding) { if (!n) { warn(); showSnackbar(c.required, 'danger'); } return; }
    setAdding(true);
    try {
      await createPerson(db, { name: n, phone: phone.trim() || null });
      success();
      setName(''); setPhone('');
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/people', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setAdding(false); }
  };

  return (
    <ScrollView keyboardDismissMode="on-drag" style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/debt'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
        <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{c.people}</Text>

      <View style={styles.addBox}>
        <TextInput value={name} onChangeText={setName} placeholder={c.name} placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={c.name} />
        <View style={styles.addRow}>
          <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={c.phone} placeholderTextColor={colors.textMuted} style={[styles.input, styles.phoneInput]} accessibilityLabel={c.phone} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bn ? 'ফোনবুক থেকে নিন' : 'Add from contacts'}
            disabled={importing}
            onPress={() => void addFromContacts()}
            style={({ pressed }) => StyleSheet.flatten([styles.contactBtn, importing && styles.disabled, pressed && styles.pressed])}
          >
            {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <AppIcon name="account-box-outline" size={icon.md} color={colors.primary} />}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={c.newPerson} disabled={adding} onPress={() => void add()} style={({ pressed }) => StyleSheet.flatten([styles.addBtn, adding && styles.disabled, pressed && styles.pressed])}>
            {adding ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <AppIcon name="account-plus-outline" size={icon.md} color={colors.onPrimary} />}
          </Pressable>
        </View>
      </View>

      <SearchInput
        value={query}
        onChangeText={setQuery}
        placeholder={bn ? 'নাম বা ফোন দিয়ে খুঁজুন' : 'Search by name or phone'}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={bn ? 'খুঁজুন' : 'Search'}
        style={styles.search}
      />

      {!ready ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : people.length === 0 ? (
        <AppState icon="account-multiple-outline" title={c.noPeople} />
      ) : (
        rows.map((p) => {
          const st = statByPerson.get(p.id) ?? { debt: 0, recv: 0, owePaisa: 0, owedPaisa: 0, overdue: false };
          const net = st.owedPaisa - st.owePaisa;
          // One line answers the question the list exists for: am I up or down with
          // this person, and by how much.
          const tone = net === 0 ? colors.textMuted : net > 0 ? accents.green.on : accents.red.on;
          const netLabel = net === 0
            ? (bn ? 'হিসাব মেটানো' : 'All settled')
            : net > 0
              ? (bn ? `পাব ${money(net)}` : `owes you ${money(net)}`)
              : (bn ? `দেব ${money(-net)}` : `you owe ${money(-net)}`);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} · ${netLabel}`}
              onPress={() => router.push(`/debt/person/${p.id}` as never)}
              style={({ pressed }) => StyleSheet.flatten([styles.row, pressed && styles.pressed])}
            >
              <View style={styles.avatar}><Text style={styles.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.rowBody}>
                <Text numberOfLines={1} style={styles.rowName}>{p.name}</Text>
                <Text numberOfLines={1} style={[styles.rowNet, { color: tone }]}>{netLabel}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {p.phone ? `${p.phone} · ` : ''}
                  {bn
                    ? `${asciiDigitsToBengali(String(st.debt))} দেনা · ${asciiDigitsToBengali(String(st.recv))} পাওনা`
                    : `${st.debt} debts · ${st.recv} receivables`}
                </Text>
              </View>
              {st.overdue ? (
                <View style={[styles.overdueDot, { backgroundColor: colors.danger }]} />
              ) : null}
              <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.xl },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginBottom: spacing.md },
    addBox: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md, ...elevation.soft },
    addRow: { flexDirection: 'row', gap: spacing.sm },
    input: { minHeight: control.inputHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input },
    phoneInput: { flex: 1 },
    addBtn: { width: control.buttonHeight, minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.soft },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    rowNet: { color: colors.textPrimary, ...typography.caption, fontWeight: '800', fontFamily: typography.numeric.fontFamily, marginTop: 1 },
    overdueDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
    search: { minHeight: control.searchHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.input, marginBottom: spacing.md },
    contactBtn: { width: control.inputHeight, height: control.inputHeight, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: colors.textSecondary, ...typography.cardTitle, fontWeight: '800' },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800' },
    rowMeta: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
