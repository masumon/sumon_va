import { useCallback, useMemo, useState } from 'react';
import { formatBangladeshDate , bangladeshDateKey } from '../../../src/i18n/date-time';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../../src/ui/AppText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AppConfirmDialog, useAppFeedback } from '../../../src/ui/AppFeedback';
import { useAppPreferences } from '../../../src/app/AppPreferences';
import { getAccountView, reverseTransaction, settleAccount, writeOffReceivable, type AccountView } from '../../../src/services/debt/debt-service';
import { removeFinanceEntryForReversedDebt } from '../../../src/services/money-bridge';
import { listAccountAudit, listInstallments, paidByInstallment, type AuditEntry } from '../../../src/services/debt/repository';
import { formatPaisa } from '../../../src/services/debt/money';
import type { Installment } from '../../../src/services/debt/types';
import { auditActionLabel, auditFieldLabel, debtCopy, interestBasisLabel, priorityLabel, purposeLabel } from '../../../src/i18n/debt';
import { riskLevel } from '../../../src/services/debt/strategy';

import { AppIcon } from '../../../src/ui/AppIcon';
import { AttachmentPanel } from '../../../src/ui/AttachmentPanel';
// Registers the debt owners with the shared attachment store (B-10c: one attachment UI everywhere).
import '../../../src/services/debt/attachments';
import { success, warn } from '../../../src/ui/haptics';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../../../src/theme';
import { logAppError } from '../../../src/services/error-log';

type Confirmable = { kind: 'SETTLE' } | { kind: 'WRITE_OFF' } | { kind: 'REVERSE'; txnId: string } | null;

export default function AccountDetail() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors, accents, language } = useAppPreferences();
  const today = bangladeshDateKey(new Date());
  const bn = language === 'bn';
  const c = useMemo(() => debtCopy(language), [language]);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const money = (p: number) => formatPaisa(p, { bnDigits: bn });
  const fmtDate = (value: string | null | undefined) => (value ? formatBangladeshDate(value, language) : '—');
  const { showSnackbar } = useAppFeedback();

  const [view, setView] = useState<AccountView | null>(null);
  const [insts, setInsts] = useState<Installment[]>([]);
  const [paidPerInst, setPaidPerInst] = useState<Map<string, number>>(new Map());
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirmable>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [v, i, paid, log] = await Promise.all([
        getAccountView(db, id), listInstallments(db, id), paidByInstallment(db, id), listAccountAudit(db, id),
      ]);
      setView(v); setInsts(i); setPaidPerInst(paid); setAudit(log);
    } catch { setView(null); }
    finally { setLoaded(true); }
  }, [db, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!view) return (
    <View style={styles.center}>
      <AppIcon name="wallet-outline" size={icon.xl} color={colors.warning} />
      <Text style={styles.notFound}>{bn ? 'হিসাব পাওয়া যায়নি' : 'Account not found'}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/debt')} style={styles.secondary}><Text style={styles.secondaryText}>{c.back}</Text></Pressable>
    </View>
  );

  const { account: a, person, balance: b } = view;
  const tone = a.direction === 'DEBT' ? accents.red : accents.green;
  const isDebt = a.direction === 'DEBT';
  // The same risk score the plan screen ranks by, shown where the decision is made.
  const risk = riskLevel({
    overdueDays: b.overdueDays,
    overduePaisa: b.overduePaisa,
    remainingPaisa: b.remainingPaisa,
    interestRateBps: a.interestRateBps ?? 0,
  });

  // Every state change goes through a confirm dialog: settling, writing off and
  // reversing all rewrite what the ledger reports, so none of them fire on a stray tap.
  const runConfirmed = async () => {
    const task = confirm;
    setConfirm(null);
    if (!task || !id || busy) return;
    setBusy(true);
    try {
      if (task.kind === 'SETTLE') await settleAccount(db, id, view.balance.paidPaisa, today);
      else if (task.kind === 'WRITE_OFF') await writeOffReceivable(db, id, today);
      else {
        await reverseTransaction(db, task.txnId, today);
        // A reversed payment that had a wallet expense riding along with it (see
        // money-bridge) must not leave that expense standing.
        await removeFinanceEntryForReversedDebt(db, task.txnId).catch(() => {});
      }
      success();
      showSnackbar(bn ? 'হয়েছে' : 'Done', 'success');
      await load();
    } catch (e) {
      warn();
      showSnackbar(logAppError('debt/account/id', e, bn ? 'কাজটা হয়নি — আবার চেষ্টা করুন' : 'That did not work — please try again'), 'danger');
    } finally { setBusy(false); }
  };

  const confirmCopy = (): { title: string; description: string } => {
    if (confirm?.kind === 'SETTLE') return { title: bn ? 'মিটমাট করবেন?' : 'Settle this debt?', description: bn ? `পরিশোধিত ${money(b.paidPaisa)} ধরে হিসাবটি বন্ধ হবে। বাকি অংশ মাফ ধরা হবে।` : `Closes the account at ${money(b.paidPaisa)} paid; the rest is treated as forgiven.` };
    if (confirm?.kind === 'WRITE_OFF') return { title: bn ? 'অবলোপন করবেন?' : 'Write this off?', description: bn ? `${money(b.remainingPaisa)} অনাদায়ী ধরা হবে।` : `${money(b.remainingPaisa)} will be marked uncollectable.` };
    return { title: bn ? 'লেনদেন বাতিল করবেন?' : 'Reverse this transaction?', description: bn ? 'হিসাব থেকে বাদ যাবে, তবে খতিয়ানে চিহ্ন থাকবে।' : 'It stops counting, but stays visible in the ledger.' };
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/debt'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
        <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
      </Pressable>

      <View style={styles.headRow}>
        <View style={[styles.kindIcon, { backgroundColor: tone.soft }]}><AppIcon name={isDebt ? 'arrow-up-bold-circle-outline' : 'arrow-down-bold-circle-outline'} size={icon.lg} color={tone.on} /></View>
        <View style={styles.headCopy}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{a.title || person?.name || (isDebt ? c.totalDebt : c.totalReceivable)}</Text>
          <Text style={styles.person}>{(a.title ? person?.name : (isDebt ? c.totalDebt : c.totalReceivable)) ?? '—'}{a.purpose ? ` · ${purposeLabel(a.purpose, language)}` : ''}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}><Text style={[styles.badgeText, { color: tone.on }]}>{c.status[b.status]}</Text></View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.editAccount}
          onPress={() => router.push(`/debt/edit/${id}` as never)}
          style={({ pressed }) => StyleSheet.flatten([styles.iconBtn, pressed && styles.pressed])}
        >
          <AppIcon name="pencil-outline" size={icon.md} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.balCard}>
        <Text style={[styles.balMain, { color: tone.on }]}>{money(b.remainingPaisa)}</Text>
        <Text style={styles.balMainLabel}>{c.remaining}</Text>
        <View style={styles.balGrid}>
          <BalCell styles={styles} label={bn ? 'মূল' : 'Principal'} value={money(b.principalPaisa)} />
          <BalCell styles={styles} label={bn ? 'সুদ' : 'Interest'} value={money(b.accruedInterestPaisa)} />
          <BalCell styles={styles} label={bn ? 'মোট প্রদেয়' : 'Total payable'} value={money(b.totalPayablePaisa)} />
          <BalCell styles={styles} label={c.paid} value={money(b.paidPaisa)} />
          {b.advancePaisa ? <BalCell styles={styles} label={bn ? 'অগ্রিম' : 'Advance'} value={money(b.advancePaisa)} /> : null}
          {b.adjustmentPaisa ? <BalCell styles={styles} label={bn ? 'সমন্বয়' : 'Adjustment'} value={money(b.adjustmentPaisa)} /> : null}
          {a.finalDueDate ? <BalCell styles={styles} label={c.dueDate} value={fmtDate(a.finalDueDate)} /> : null}
          {a.priority !== 'MEDIUM' ? <BalCell styles={styles} label={c.priority} value={priorityLabel(a.priority, language)} /> : null}
          {a.interestType !== 'NONE' && a.interestType !== 'FLAT_TOTAL'
            ? <BalCell styles={styles} label={c.interestBasis} value={interestBasisLabel(a.interestBasis, language)} />
            : null}
          {b.remainingPaisa > 0 ? <BalCell styles={styles} label={bn ? 'ঝুঁকি' : 'Risk'} value={riskLabel(risk, bn)} /> : null}
        </View>
      </View>

      {b.status !== 'COMPLETED' && b.status !== 'SETTLED' && b.status !== 'WRITTEN_OFF' && b.status !== 'CANCELLED' ? (
        <View style={styles.actionsRow}>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/debt/pay/${id}` as never)} style={({ pressed }) => StyleSheet.flatten([styles.primary, styles.grow, pressed && styles.pressed])}>
            <AppIcon name="cash-check" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryText}>{isDebt ? c.makePayment : c.recordReceipt}</Text>
          </Pressable>
          {isDebt ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirm({ kind: 'SETTLE' })} style={({ pressed }) => StyleSheet.flatten([styles.ghost, busy && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="handshake-outline" size={icon.sm} color={colors.primary} /><Text style={styles.ghostText}>{c.status.SETTLED}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirm({ kind: 'WRITE_OFF' })} style={({ pressed }) => StyleSheet.flatten([styles.ghost, busy && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="cancel" size={icon.sm} color={colors.primary} /><Text style={styles.ghostText}>{c.status.WRITTEN_OFF}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={styles.linkRow}>
        <LinkBtn styles={styles} colors={colors} icon="cash-plus" label={isDebt ? c.topUp : (bn ? 'আরও ধার দিন' : 'Lend more')} onPress={() => router.push(`/debt/topup/${id}` as never)} />
        <LinkBtn styles={styles} colors={colors} icon="tune" label={c.adjust} onPress={() => router.push(`/debt/adjust/${id}` as never)} />
        <LinkBtn styles={styles} colors={colors} icon="calendar-edit" label={c.editSchedule} onPress={() => router.push(`/debt/schedule/${id}` as never)} />
        {person ? <LinkBtn styles={styles} colors={colors} icon="account-outline" label={c.editPerson} onPress={() => router.push(`/debt/person/${person.id}` as never)} /> : null}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>{bn ? 'কিস্তি' : 'Installments'}</Text>
            {insts.length ? (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{b.installmentsPaidCount}/{b.installmentsTotalCount}</Text>
              </View>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/debt/schedule/${id}` as never)} style={({ pressed }) => StyleSheet.flatten([styles.sectionAction, pressed && styles.pressed])}>
            <Text style={styles.sectionActionText}>{insts.length ? c.edit : c.addInstallment}</Text>
          </Pressable>
        </View>
        {insts.length === 0 ? (
          <Text style={styles.empty}>{bn ? 'কোনো কিস্তির সূচি নেই' : 'No instalment plan'}</Text>
        ) : (
          [...insts]
            .sort((x, y) => (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') || x.seq - y.seq)
            .map((it) => {
              const paidHere = paidPerInst.get(it.id) ?? 0;
              const settled = paidHere >= it.amountPaisa;
              const overdue = !settled && !!it.dueDate && it.dueDate.slice(0, 10) < today;
              return (
                <Pressable
                  key={it.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${bn ? 'কিস্তি' : 'Instalment'} ${it.seq} · ${money(it.amountPaisa)}`}
                  disabled={settled}
                  onPress={() => router.push(`/debt/pay/${id}?installment=${it.id}` as never)}
                  style={({ pressed }) => StyleSheet.flatten([styles.instRow, pressed && styles.pressed])}
                >
                  <AppIcon
                    name={settled ? 'check-circle' : overdue ? 'alert-circle-outline' : 'circle-outline'}
                    size={icon.sm}
                    color={settled ? accents.green.on : overdue ? colors.danger : colors.textMuted}
                  />
                  <View style={styles.instBody}>
                    <Text style={styles.instAmt}>{money(it.amountPaisa)}</Text>
                    <Text style={[styles.instDue, overdue && { color: colors.danger }]}>
                      {it.dueDate ?? '—'}{paidHere > 0 && !settled ? ` · ${money(paidHere)} ${bn ? 'জমা' : 'paid'}` : ''}
                    </Text>
                  </View>
                  {!settled ? <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} /> : null}
                </Pressable>
              );
            })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{c.ledger}</Text>
        {view.transactions.filter((t) => !t.reversed).length === 0 ? (
          <Text style={styles.empty}>{bn ? 'কোনো লেনদেন নেই' : 'No transactions'}</Text>
        ) : (
          [...view.transactions].reverse().map((t) => {
            const reversible = !t.reversed && t.kind !== 'REVERSAL';
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityHint={reversible ? (bn ? 'সংশোধন বা বাতিল করতে চেপে ধরুন' : 'Long-press to reverse; tap to open and correct') : undefined}
                onPress={() => router.push(`/debt/txn/${t.id}` as never)}
                onLongPress={reversible ? () => setConfirm({ kind: 'REVERSE', txnId: t.id }) : undefined}
                style={({ pressed }) => StyleSheet.flatten([styles.txnRow, t.reversed && styles.txnReversed, pressed && reversible && styles.pressed])}
              >
                <AppIcon name={txnIcon(t.kind)} size={icon.sm} color={colors.textMuted} />
                <View style={styles.txnBody}>
                  <Text style={styles.txnKind}>{txnLabel(t.kind, bn)}{t.reversed ? (bn ? ' (বাতিল)' : ' (reversed)') : ''}</Text>
                  <Text style={styles.txnDate}>{fmtDate(t.txnDate)}{t.note ? ` · ${t.note}` : ''}</Text>
                </View>
                <Text style={styles.txnAmt}>{money(t.amountPaisa)}</Text>
              </Pressable>
            );
          })
        )}
      </View>

      {audit.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{c.history}</Text>
          {audit.slice(0, 12).map((e) => (
            <View key={e.id} style={styles.auditRow}>
              <AppIcon name={auditIcon(e.action)} size={icon.xs} color={colors.textMuted} />
              <View style={styles.txnBody}>
                <Text style={styles.auditTitle}>
                  {auditFieldLabel(e.field, language)} · {auditActionLabel(e.action, language)}
                </Text>
                {e.oldValue || e.newValue ? (
                  <Text numberOfLines={1} style={styles.auditVal}>
                    {e.oldValue ? `${auditValue(e.field, e.oldValue, money, language)} → ` : ''}
                    {auditValue(e.field, e.newValue, money, language)}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.auditAt}>{e.at.slice(0, 10)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {id ? <AttachmentPanel ownerType="DEBT_ACCOUNT" ownerId={id} /> : null}

      <AppConfirmDialog
        visible={confirm !== null}
        title={confirmCopy().title}
        description={confirmCopy().description}
        confirmLabel={bn ? 'হ্যাঁ' : 'Yes'}
        cancelLabel={c.cancel}
        danger
        icon="alert"
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />
    </ScrollView>
  );
}

function BalCell({ styles, label, value }: { styles: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return (
    <View style={styles.balCell}>
      <Text style={styles.balCellLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.balCellVal}>{value}</Text>
    </View>
  );
}
function LinkBtn({ styles, colors, icon: ic, label, onPress }: { styles: ReturnType<typeof makeStyles>; colors: ThemeColors; icon: 'tune' | 'calendar-edit' | 'account-outline' | 'cash-plus'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => StyleSheet.flatten([styles.linkBtn, pressed && styles.pressed])}>
      <AppIcon name={ic} size={icon.sm} color={colors.primary} />
      <Text numberOfLines={1} style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Audit rows store raw column values, so a principal change reads "5000000" — paisa, and
 * meaningless on screen. Money fields are formatted, status and priority get their labels,
 * and anything else passes through as it was written.
 */
function auditValue(
  field: string,
  value: string | null,
  money: (p: number) => string,
  language: 'bn' | 'en',
): string {
  if (value === null || value === '') return '—';
  if (field === 'principal' || field === 'flatTotal') {
    const n = Number(value);
    return Number.isFinite(n) ? money(n) : value;
  }
  if (field === 'correction') {
    // Stored as "<paisa>@<date>" by the correction flow.
    const [amount, date] = value.split('@');
    const n = Number(amount);
    return Number.isFinite(n) && date ? `${money(n)} · ${date}` : value;
  }
  if (field === 'status') return debtCopy(language).status[value] ?? value;
  if (field === 'priority') return priorityLabel(value, language);
  if (field === 'interestBasis') return interestBasisLabel(value, language);
  if (field === 'interestType') return value;
  if (field === 'interestRate') {
    const n = Number(value);
    return Number.isFinite(n) ? `${n / 100}%` : value;
  }
  return value;
}

function riskLabel(level: string, bn: boolean): string {
  const map: Record<string, [string, string]> = {
    LOW: ['কম', 'Low'], MEDIUM: ['মাঝারি', 'Medium'], HIGH: ['বেশি', 'High'], CRITICAL: ['সবচেয়ে বেশি', 'Critical'],
  };
  const e = map[level];
  return e ? (bn ? e[0] : e[1]) : level;
}

function auditIcon(action: string): 'plus-circle-outline' | 'pencil-outline' | 'trash-can-outline' | 'close-circle-outline' {
  if (action === 'CREATE') return 'plus-circle-outline';
  if (action === 'DELETE') return 'trash-can-outline';
  if (action === 'REVERSE') return 'close-circle-outline';
  return 'pencil-outline';
}

function txnIcon(kind: string): 'cash-plus' | 'cash-minus' | 'swap-horizontal' | 'tune' | 'handshake-outline' | 'close-circle-outline' {
  if (kind === 'NEW_DEBT' || kind === 'NEW_RECEIVABLE') return 'cash-plus';
  if (kind === 'PAYMENT' || kind === 'RECEIPT') return 'cash-minus';
  if (kind === 'REVERSAL') return 'close-circle-outline';
  if (kind === 'SETTLEMENT') return 'handshake-outline';
  if (kind === 'ADJUSTMENT') return 'tune';
  return 'swap-horizontal';
}
function txnLabel(kind: string, bn: boolean): string {
  const map: Record<string, [string, string]> = {
    NEW_DEBT: ['ঋণ গ্রহণ', 'Debt taken'], NEW_RECEIVABLE: ['ঋণ প্রদান', 'Loan given'],
    PAYMENT: ['পরিশোধ', 'Payment'], RECEIPT: ['আদায়', 'Receipt'], ADJUSTMENT: ['সমন্বয়', 'Adjustment'],
    REVERSAL: ['বাতিল', 'Reversal'], SETTLEMENT: ['মিটমাট', 'Settlement'], WRITE_OFF: ['অবলোপন', 'Write-off'],
    INTEREST_ACCRUAL: ['সুদ', 'Interest'],
  };
  const e = map[kind];
  return e ? (bn ? e[0] : e[1]) : kind;
}

function makeStyles(colors: ThemeColors, _accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl + spacing.xl },
    center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    notFound: { color: colors.textPrimary, ...typography.cardTitle, flexShrink: 1, textAlign: 'center' },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    kindIcon: { width: 48, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
    headCopy: { flex: 1, minWidth: 0 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700' },
    person: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    badge: { borderWidth: border.thin, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    badgeText: { ...typography.caption, fontWeight: '800' },
    balCard: { marginTop: spacing.md, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.lg, ...elevation.soft },
    balMain: { ...typography.display, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    balMainLabel: { color: colors.textSecondary, ...typography.caption, marginTop: 2 },
    balGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    balCell: { width: '47%', maxWidth: '47%', flexGrow: 1, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.sm },
    balCellLabel: { color: colors.textMuted, ...typography.caption },
    balCellVal: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', fontFamily: typography.numeric.fontFamily, marginTop: 2 },
    actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    grow: { flex: 1 },
    primary: { minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    primaryText: { color: colors.onPrimary, ...typography.callout, fontWeight: '800' },
    ghost: { minHeight: control.buttonHeight, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    ghostText: { color: colors.primary, ...typography.callout, fontWeight: '800' },
    section: { marginTop: spacing.lg },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    countPill: { borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.sm, paddingVertical: 1, marginBottom: spacing.sm },
    countText: { color: colors.textSecondary, ...typography.caption, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    sectionAction: { minHeight: layout.minTouchTarget, justifyContent: 'center', paddingLeft: spacing.md },
    sectionActionText: { color: colors.primary, ...typography.caption, fontWeight: '800' },
    iconBtn: { width: layout.iconButtonSize, height: layout.iconButtonSize, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    linkBtn: { flexGrow: 1, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.smd, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    linkText: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    auditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: border.thin, borderBottomColor: colors.border },
    auditTitle: { color: colors.textSecondary, ...typography.caption, fontWeight: '700' },
    auditVal: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    auditAt: { color: colors.textMuted, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    sectionTitle: { color: colors.textMuted, ...typography.section, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
    instRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
    instBody: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm},
    instAmt: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700', fontFamily: typography.numeric.fontFamily },
    instDue: { color: colors.textSecondary, ...typography.caption },
    txnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: border.thin, borderBottomColor: colors.border },
    txnReversed: { opacity: 0.5 },
    txnBody: { flex: 1, minWidth: 0 },
    txnKind: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    txnDate: { color: colors.textMuted, ...typography.caption, marginTop: 1 },
    txnAmt: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    empty: { color: colors.textMuted, ...typography.bodySmall },
    secondary: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.textSecondary, ...typography.body, fontWeight: '700' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.78 },
  });
}
