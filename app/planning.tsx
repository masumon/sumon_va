import { withFabRoom } from '../src/ui/FloatingApon';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { asciiDigitsToBengali } from '../src/services/debt/money';
import { AppText as Text } from '../src/ui/AppText';
import { ModuleGuide } from '../src/ui/ModuleGuide';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { getDailyPlan, planInboxTasks, type DailyPlan } from '../src/services/planning-service';
import { useTaskStore } from '../src/store/task.store';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppButton, AppCard, AppSkeletonList, AppState } from '../src/ui/AppSurface';
import { AppIcon } from '../src/ui/AppIcon';
import { tapSelect } from '../src/ui/haptics';
import { RowLeading } from '../src/ui/RowLeading';
import { loadImageThumbs } from '../src/services/attachment-thumbs';
import { bangladeshDateKey, formatBangladeshDate, formatBangladeshRelativeDate, formatBangladeshNumber, formatBangladeshTime, formatDayKey, zonedClock } from '../src/i18n/date-time';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, priorityAccentName, type AccentRole, type ThemeAccents, type ThemeColors } from '../src/theme';
import type { TaskPriority } from '../src/types';
import { logAppError } from '../src/services/error-log';
import { openTaskPreview } from '../src/ui/ItemPreviews';

/** Bengali numerals in Bengali. ASCII digits inside a Bengali line make Android
 *  mis-measure the text and clip it, which is why this exists. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

function priorityLabel(priority: TaskPriority, bn: boolean) {
  const labels: Record<TaskPriority, { en: string; bn: string }> = { URGENT: { en: 'Urgent', bn: 'জরুরি' }, HIGH: { en: 'High', bn: 'উচ্চ' }, MEDIUM: { en: 'Medium', bn: 'মাঝারি' }, LOW: { en: 'Low', bn: 'কম' } };
  return labels[priority][bn ? 'bn' : 'en'];
}
function planDateLabel(value: string, language: 'bn' | 'en') { try { return formatBangladeshDate(`${value}T00:00:00`, language); } catch { return value; } }
function addDays(base: Date, days: number) { const next = new Date(base); next.setHours(12, 0, 0, 0); next.setDate(next.getDate() + days); return next; }

export default function PlanningScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language, weekStartsOn } = useAppPreferences();
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const bn = language === 'bn';
  const params = useLocalSearchParams<{ filter?: string; date?: string }>();
  const [focusFilter, setFocusFilter] = useState<string | null>(params.filter ?? null);
  const [cursor, setCursor] = useState(() => {
    // A `date=YYYY-MM-DD` param (e.g. from the month view) opens straight on that day.
    if (params.date && /^\d{4}-\d{2}-\d{2}$/u.test(params.date)) {
      const picked = new Date(`${params.date}T12:00:00`);
      if (!Number.isNaN(picked.getTime())) return picked;
    }
    const d = new Date(); d.setHours(12, 0, 0, 0); return d;
  });
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const loadTasks = useTaskStore(state => state.load);
  const allTasks = useTaskStore(state => state.tasks);

  // Load the full task list once so the week strip can show which days already carry
  // work — the per-day plan only covers `cursor`.
  useEffect(() => { void loadTasks(db); }, [db, loadTasks]);
  const dayMarks = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTasks) {
      if (['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(t.status)) continue;
      const key = t.plannedDate || (t.dueAt ? bangladeshDateKey(t.dueAt) : null);
      if (key) s.add(key);
    }
    return s;
  }, [allTasks]);

  const loadPlan = useCallback(async (date: Date) => {
    setError(null);
    try { setPlan(await getDailyPlan(db, date)); }
    catch (error) { logAppError('planning.loadPlan', error, 'Unable to load daily plan'); setError(bn ? 'দৈনিক পরিকল্পনা লোড করা যায়নি' : 'Unable to load daily plan'); }
  }, [bn, db]);

  useEffect(() => { let active = true; void getDailyPlan(db, cursor).then(next => { if (active) { setError(null); setPlan(next); } }).catch((error) => { logAppError('planning.dayEffect', error, 'Unable to load daily plan'); if (active) setError(bn ? 'দৈনিক পরিকল্পনা লোড করা যায়নি' : 'Unable to load daily plan'); }); return () => { active = false; }; }, [bn, db, cursor]);

  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const inboxIdKey = (plan?.inbox ?? []).map(t => t.id).join(',');
  useEffect(() => {
    let alive = true;
    loadImageThumbs(db, 'TASK', inboxIdKey ? inboxIdKey.split(',') : [])
      .then(map => { if (alive) setThumbs(map); })
      .catch(() => { if (alive) setThumbs(new Map()); });
    return () => { alive = false; };
  }, [db, inboxIdKey]);

  const planTask = useCallback(async (id: string) => {
    if (busyId) return;
    setBusyId(id); setError(null);
    try { await planInboxTasks(db, [id], cursor); tapSelect(); await Promise.all([loadPlan(cursor), loadTasks(db)]); }
    catch { setError(bn ? 'কাজ প্ল্যান করা যায়নি' : 'Unable to plan task'); }
    finally { setBusyId(null); }
  }, [busyId, db, cursor, loadPlan, loadTasks, bn]);

  const labels = useMemo(() => (bn
    ? { eyebrow: 'দৈনিক পরিকল্পনা', plan: 'প্ল্যান', newTask: 'নতুন কাজ', inbox: 'ইনবক্স', today: 'আজ', subtitle: 'দিন বেছে নিন — সেদিনের কাজ সময় ধরে সাজানো থাকে।', overdue: 'বকেয়া', progress: 'চলমান', scheduled: 'আজ নির্ধারিত', inboxTitle: 'ইনবক্সে অপেক্ষমাণ', empty: 'ইনবক্স খালি — এই দিনের সব কিছু গোছানো আছে। ✨', noTime: 'সময় নেই', retry: 'আবার চেষ্টা করুন', prev: 'আগের দিন', next: 'পরের দিন' }
    : { eyebrow: 'DAILY PLANNING', plan: 'Plan', newTask: 'New task', inbox: 'Inbox', today: 'Today', subtitle: 'Pick a day — its tasks are laid out by time.', overdue: 'Overdue', progress: 'In progress', scheduled: 'Scheduled today', inboxTitle: 'Waiting in inbox', empty: 'Inbox is empty — this day is all set. ✨', noTime: 'No time', retry: 'Retry', prev: 'Previous day', next: 'Next day' }), [bn]);

  // Timeline sections (overdue + time buckets) are derived from the plan + focus filter
  // only — recompute when those change, not on every busyId / cursor-arrow tap.
  const daySections = useMemo(() => {
    if (!plan) return null;
    const seen = new Set<string>();
    const matchFilter = (t: DailyPlan['scheduled'][number]) => {
      if (focusFilter === 'high') return t.priority === 'HIGH' || t.priority === 'URGENT';
      if (focusFilter === 'progress') return t.status === 'IN_PROGRESS';
      return true;
    };
    const showOverdue = focusFilter !== 'due' && focusFilter !== 'progress';
    const showDay = focusFilter !== 'overdue';
    const overdueTasks = showOverdue ? plan.overdue.filter(matchFilter).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')) : [];
    const overdueIds = new Set(plan.overdue.map(t => t.id));
    // Overdue rows win — never also list the same task inside a time bucket.
    const dayTasks = showDay ? [...plan.scheduled, ...plan.inProgress].filter(t => (seen.has(t.id) || overdueIds.has(t.id) ? false : (seen.add(t.id), true))).filter(matchFilter) : [];
    const order: BucketKey[] = ['morning', 'noon', 'evening', 'night', 'unset'];
    const bLabels: Record<BucketKey, string> = bn
      ? { morning: 'সকাল', noon: 'দুপুর', evening: 'বিকাল', night: 'সন্ধ্যা', unset: 'সময় নির্ধারিত নয়' }
      : { morning: 'Morning', noon: 'Afternoon', evening: 'Evening', night: 'Night', unset: 'No time set' };
    const groups = order
      .map(k => ({ key: k, label: bLabels[k], items: dayTasks.filter(t => bucketKey(t) === k).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')) }))
      .filter(g => g.items.length);
    return { overdueTasks, groups };
  }, [plan, focusFilter, bn]);

  const renderInboxRow = useCallback(({ item }: { item: DailyPlan['inbox'][number] }) => (
    <PlanningInboxRow task={item} busy={busyId === item.id} anyBusy={Boolean(busyId)} styles={styles} colors={colors} accents={accents} bn={bn} planLabel={labels.plan} thumbUri={thumbs.get(item.id)} onPlan={planTask} />
  ), [busyId, styles, colors, accents, bn, labels.plan, thumbs, planTask]);

  // The same zone the plan itself is keyed in. Read from the device's own calendar these
  // two disagreed for the first six hours of every day, and "today" quietly became false.
  const todayKey = useMemo(() => bangladeshDateKey(new Date()), []);
  const isToday = plan?.date === todayKey;
  const relative = formatBangladeshRelativeDate(cursor, language);

  if (!plan && !error) return <AppSkeletonList rows={5} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>{labels.eyebrow}</Text>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{plan ? planDateLabel(plan.date, language) : labels.plan}</Text>
          </View>
          <View style={styles.headerActions}>
            <ModuleGuide id="planning" />
            <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'মাসিক ভিউ' : 'Month view'} onPress={() => router.push('/calendar' as never)} style={({ pressed }) => StyleSheet.flatten([styles.monthBtn, pressed && styles.pressed])}>
              <AppIcon name="calendar-month-outline" size={icon.md} color={colors.primary} />
            </Pressable>
            <AppButton label={labels.newTask} icon="plus" onPress={() => router.push('/task-editor')} />
          </View>
        </View>
        <Text style={styles.subtitle}>{labels.subtitle}</Text>

        <View style={styles.dateNav}>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'আগের সপ্তাহ' : 'Previous week'} onPress={() => setCursor(c => addDays(c, -7))} style={({ pressed }) => StyleSheet.flatten([styles.navArrow, pressed && styles.pressed])}>
            <AppIcon name="chevron-double-left" size={icon.md} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={labels.prev} onPress={() => setCursor(c => addDays(c, -1))} style={({ pressed }) => StyleSheet.flatten([styles.navArrow, pressed && styles.pressed])}>
            <AppIcon name="chevron-left" size={icon.md} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={labels.today} onPress={() => setCursor(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })} style={({ pressed }) => StyleSheet.flatten([styles.todayChip, isToday && styles.todayChipActive, pressed && styles.pressed])}>
            <AppIcon name={isToday ? 'circle-slice-8' : 'calendar-today'} size={icon.sm} color={isToday ? colors.onPrimary : colors.primary} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.todayChipText, isToday && styles.todayChipTextActive]}>{relative}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={labels.next} onPress={() => setCursor(c => addDays(c, 1))} style={({ pressed }) => StyleSheet.flatten([styles.navArrow, pressed && styles.pressed])}>
            <AppIcon name="chevron-right" size={icon.md} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'পরের সপ্তাহ' : 'Next week'} onPress={() => setCursor(c => addDays(c, 7))} style={({ pressed }) => StyleSheet.flatten([styles.navArrow, pressed && styles.pressed])}>
            <AppIcon name="chevron-double-right" size={icon.md} color={colors.primary} />
          </Pressable>
        </View>

        <View style={styles.weekStrip}>
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date(cursor); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7) + i);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const markKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const isSel = key === `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
            const n = new Date();
            const dayIsToday = key === `${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`;
            const hasTasks = dayMarks.has(markKey);
            const wd = (bn ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[d.getDay()];
            return (
              <Pressable key={i} accessibilityRole="button" accessibilityState={{ selected: isSel }} accessibilityLabel={`${wd} ${d.getDate()}${hasTasks ? (bn ? ' · কাজ আছে' : ' · has tasks') : ''}`} onPress={() => setCursor(d)} style={({ pressed }) => StyleSheet.flatten([styles.weekDay, isSel && styles.weekDaySel, pressed && styles.pressed])}>
                <Text style={[styles.weekWd, isSel && styles.weekTextSel]}>{wd}</Text>
                <Text style={[styles.weekNum, isSel && styles.weekTextSel, !isSel && dayIsToday && styles.weekNumToday]}>{formatBangladeshNumber(d.getDate(), language)}</Text>
                <View style={[styles.weekDot, hasTasks && (isSel ? styles.weekDotSel : styles.weekDotOn)]} />
              </Pressable>
            );
          })}
        </View>

        {plan ? (
          <View style={styles.summaryRow}>
            {/* Each count opens its own tasks; tapping it again shows the whole day (RC.4 QA). */}
            <SummaryPill label={labels.overdue} count={plan.overdue.length} tone={accents.red} styles={styles} bn={bn} active={focusFilter === 'overdue'} onPress={() => setFocusFilter(f => (f === 'overdue' ? null : 'overdue'))} />
            <SummaryPill label={labels.progress} count={plan.inProgress.length} tone={accents.blue} styles={styles} bn={bn} active={focusFilter === 'progress'} onPress={() => setFocusFilter(f => (f === 'progress' ? null : 'progress'))} />
            <SummaryPill label={labels.scheduled} count={plan.scheduled.length} tone={accents.green} styles={styles} bn={bn} active={focusFilter === 'due'} onPress={() => setFocusFilter(f => (f === 'due' ? null : 'due'))} />
          </View>
        ) : null}
      </View>

      {error ? (
        <AppState title={bn ? 'প্ল্যান লোড করা যায়নি' : 'Could not load plan'} description={bn ? 'আজকের পরিকল্পনা তৈরি করা যায়নি।' : 'The local daily plan could not be prepared.'} icon="alert-circle-outline" actionLabel={labels.retry} onAction={() => void loadPlan(cursor)} />
      ) : null}

      {focusFilter ? (
        <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ফিল্টার সরান' : 'Clear filter'} onPress={() => setFocusFilter(null)} style={({ pressed }) => StyleSheet.flatten([styles.linkPill, { alignSelf: 'flex-start', marginBottom: spacing.sm }, pressed && styles.pressed])}>
          <Text style={styles.linkText}>{(bn ? { overdue: 'শুধু বকেয়া', due: 'শুধু আজকের', progress: 'শুধু চলমান', high: 'শুধু উচ্চ অগ্রাধিকার' } : { overdue: 'Overdue only', due: 'Due today only', progress: 'In progress only', high: 'High priority only' })[focusFilter] ?? focusFilter}</Text>
          <AppIcon name="close" size={icon.sm} color={colors.primary} />
        </Pressable>
      ) : null}

      {plan && daySections ? (
        <FlatList
          data={plan.inbox}
          keyExtractor={item => item.id}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <>
              {daySections.overdueTasks.length ? <TimelineGroup label={labels.overdue} items={daySections.overdueTasks} accent={accents.red} withDate styles={styles} colors={colors} accents={accents} language={language} /> : null}
              {daySections.groups.map(g => <TimelineGroup key={g.key} label={g.label} items={g.items} styles={styles} colors={colors} accents={accents} language={language} />)}
              {!daySections.overdueTasks.length && !daySections.groups.length ? <View style={styles.section}><Text style={styles.emptyDay}>{focusFilter ? (bn ? 'এমন কোনো কাজ নেই।' : 'No tasks like this.') : (bn ? 'আজকের জন্য নির্ধারিত কোনো কাজ নেই।' : 'Nothing scheduled for this day.')}</Text></View> : null}
              <View style={styles.inboxSection}>
                <LinearGradient colors={[`${colors.background}00`, colors.background]} style={styles.inboxFade} pointerEvents="none" />
                <View style={styles.inboxHeaderRow}>
                  <Text numberOfLines={1} style={[styles.sectionTitle, { flexShrink: 1, flexGrow: 1 }]}>{labels.inboxTitle} · {bn ? bnNum(plan.inbox.length) : plan.inbox.length}</Text>
                  <Pressable onPress={() => router.push("/inbox" as never)}  accessibilityRole="button" accessibilityLabel={labels.inbox} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.linkPill, pressed && styles.pressed])}>
                      <Text style={styles.linkText}>{labels.inbox}</Text>
                      <AppIcon name="chevron-right" size={icon.sm} color={colors.primary} />
                    </Pressable>
                </View>
              </View>
            </>
          }
          ListEmptyComponent={<AppState title={labels.empty} icon="inbox" />}
          contentContainerStyle={withFabRoom(styles.list)}
          renderItem={renderInboxRow}
        />
      ) : null}
    </View>
  );
}

const PlanningInboxRow = memo(function PlanningInboxRow({ task, busy, anyBusy, styles, colors, accents, bn, planLabel, thumbUri, onPlan }: {
  task: DailyPlan['inbox'][number]; busy: boolean; anyBusy: boolean; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; bn: boolean; planLabel: string; thumbUri?: string; onPlan: (id: string) => void;
}) {
  const tone = accents[priorityAccentName(task.priority)];
  return (
    <AppCard style={styles.row}>
      <View style={[styles.priorityBar, { backgroundColor: tone.base }]} />
      <RowLeading thumbUri={thumbUri} icon="inbox-arrow-down-outline" tone="orange" size={38} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${bn ? 'কাজ খুলুন' : 'Open task'} ${task.title}`} onPress={() => openTaskPreview(task)} style={({ pressed }) => StyleSheet.flatten([styles.body, pressed && styles.pressed])}>
        <Text numberOfLines={3} style={styles.task}>{task.title}</Text>
        <Text style={[styles.meta, { color: tone.on }]}>{priorityLabel(task.priority, bn)}</Text>
      </Pressable>
      <Pressable disabled={anyBusy} onPress={() => void onPlan(task.id)} style={({ pressed }) => StyleSheet.flatten([styles.planButton, anyBusy && styles.disabled, pressed && styles.pressed])} accessibilityRole="button" accessibilityState={{ busy, disabled: anyBusy }} accessibilityLabel={`${planLabel} ${task.title}`}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="calendar-check-outline" size={icon.sm} color={colors.onPrimary} /><Text style={styles.planText}>{planLabel}</Text></>}
      </Pressable>
    </AppCard>
  );
});

function SummaryPill({ label, count, tone, styles, bn, active, onPress }: { label: string; count: number; tone: AccentRole; styles: ReturnType<typeof makeStyles>; bn: boolean; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${label}: ${bn ? bnNum(count) : count}`} onPress={onPress} style={({ pressed }) => StyleSheet.flatten([styles.summaryPill, { backgroundColor: tone.soft, borderColor: active ? tone.on : tone.border }, active && { borderWidth: 2 }, pressed && styles.pressed])}>
      <Text style={[styles.summaryCount, { color: tone.on }]}>{bn ? bnNum(count) : count}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.summaryLabel, { color: tone.on }]}>{label}</Text>
    </Pressable>
  );
}

type BucketKey = 'morning' | 'noon' | 'evening' | 'night' | 'unset';
function bucketKey(task: DailyPlan['scheduled'][number]): BucketKey {
  if (!task.dueAt) return 'unset';
  // The app's own zone (Settings), not a fixed Asia/Dhaka.
  const h = Number(zonedClock(task.dueAt).slice(0, 2));
  if (Number.isNaN(h)) return 'unset';
  return h < 12 ? 'morning' : h < 16 ? 'noon' : h < 19 ? 'evening' : 'night';
}
function timeStr(task: DailyPlan['scheduled'][number], language: 'bn' | 'en'): string {
  if (!task.dueAt) return '—';
  // RC.4 QA: "৯:০০ AM" — English AM/PM inside Bengali. Same formatter as every other screen.
  try { return formatBangladeshTime(task.dueAt, language); } catch { return '—'; }
}

const TimelineGroup = memo(function TimelineGroup({ label, items, accent, withDate = false, styles, colors, accents, language }: { label: string; items: DailyPlan['scheduled']; accent?: AccentRole; withDate?: boolean; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; language: 'bn' | 'en' }) {
  const bn = language === 'bn';
  return (
    <View style={styles.section}>
      <Text style={styles.groupLabel}>{label} · {bn ? bnNum(items.length) : items.length}</Text>
      {items.slice(0, 40).map(task => {
        const tone = accent ?? accents[priorityAccentName(task.priority)];
        return (
          <Pressable key={task.id} onPress={() => openTaskPreview(task)} accessibilityRole="button" accessibilityLabel={`${bn ? 'কাজ খুলুন' : 'Open task'} ${task.title}`} style={({ pressed }) => StyleSheet.flatten([styles.tlRow, pressed && styles.pressed])}>
              <View style={styles.tlLeft}>
                {/* Overdue tasks are from other days — the time alone did not say which (rc.7). */}
                {withDate && task.dueAt ? <Text numberOfLines={1} adjustsFontSizeToFit style={styles.tlDate}>{formatDayKey(bangladeshDateKey(task.dueAt), language).replace(/,?\s*[\d০-৯]{4}$/u, '')}</Text> : null}
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.tlTime}>{timeStr(task, language)}</Text>
                <View style={styles.tlLine}><View style={[styles.tlDot, { backgroundColor: tone.base, borderColor: tone.soft }]} /></View>
              </View>
              <View style={styles.tlCard}>
                <Text numberOfLines={2} style={styles.task}>{task.title}</Text>
                <Text style={[styles.compactMeta, { color: accents[priorityAccentName(task.priority)].on }]}>{priorityLabel(task.priority, bn)}</Text>
              </View>
              <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} />
            </Pressable>
        );
      })}
      {items.length > 40 ? <Text style={styles.groupLabel}>{bn ? `আরও ${bnNum(items.length - 40)}টি` : `+${items.length - 40} more`}</Text> : null}
    </View>
  );
});

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    monthBtn: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    headingCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.sm },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.sm },
    dateNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    navArrow: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    todayChip: { flex: 1, minHeight: control.iconButtonSize, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
    todayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    todayChipText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    todayChipTextActive: { color: colors.onPrimary },
    weekStrip: { flexDirection: 'row', gap: spacing.xxs, marginTop: spacing.sm },
    weekDay: { flex: 1, minHeight: 54, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: spacing.xs },
    weekDaySel: { backgroundColor: colors.primary, borderColor: colors.primary },
    weekWd: { color: colors.textMuted, ...typography.section },
    weekNum: { color: colors.textPrimary, ...typography.meta, fontFamily: typography.numeric.fontFamily },
    weekDot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: 'transparent', marginTop: 1 },
    weekDotOn: { backgroundColor: colors.primary },
    weekDotSel: { backgroundColor: colors.onPrimary },
    weekTextSel: { color: colors.onPrimary },
    weekNumToday: { color: colors.primary },
    summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    summaryPill: { flex: 1, borderWidth: border.thin, borderRadius: radius.lg, paddingVertical: spacing.smd, paddingHorizontal: spacing.sm, alignItems: 'center' },
    summaryCount: { ...typography.heading, fontWeight: '700' },
    summaryLabel: { ...typography.caption, fontWeight: '700', marginTop: spacing.xxs },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    section: { marginBottom: spacing.md },
    sectionTitle: { color: colors.textPrimary, ...typography.cardTitle, marginBottom: spacing.sm },
    groupLabel: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, letterSpacing: 0.6, marginTop: spacing.sm, marginBottom: spacing.xs },
    emptyDay: { color: colors.textMuted, ...typography.bodySmall, textAlign: 'center', paddingVertical: spacing.md },
    tlRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm, marginBottom: spacing.xs },
    tlLeft: { width: 64, alignItems: 'center' },
    tlDate: { color: colors.textPrimary, ...typography.section, fontWeight: '700', textAlign: 'center' },
    tlTime: { color: colors.textSecondary, ...typography.section, fontFamily: typography.numeric.fontFamily, marginBottom: spacing.xxs, textAlign: 'center' },
    tlLine: { flex: 1, width: 2, backgroundColor: colors.border, alignItems: 'center' },
    tlDot: { width: 12, height: 12, borderRadius: radius.pill, borderWidth: 3 },
    tlCard: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.smd, justifyContent: 'center', ...elevation.soft },
    inboxSection: { position: 'relative', marginTop: spacing.lg },
    inboxFade: { position: 'absolute', left: 0, right: 0, top: -spacing.xl, height: spacing.xl },
    inboxHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.sm},
    linkPill: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingLeft: spacing.smd, paddingRight: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
    linkText: { color: colors.primary, ...typography.bodySmall, fontWeight: '700' },
    compact: { minHeight: control.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.xs, ...elevation.soft },
    compactIcon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    compactCopy: { flex: 1, minWidth: 0 },
    compactMeta: { ...typography.section, color: colors.textMuted, marginTop: spacing.xxs, fontWeight: '700' },
    row: { minHeight: control.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.sm, overflow: 'hidden' },
    priorityBar: { width: 4, alignSelf: 'stretch', borderRadius: radius.pill },
    body: { flex: 1, minWidth: 0, minHeight: control.iconButtonSize, justifyContent: 'center', paddingHorizontal: spacing.xs },
    task: { color: colors.textPrimary, ...typography.meta, fontWeight: '700' },
    meta: { ...typography.section, marginTop: spacing.xxs, fontWeight: '800' },
    priority: { ...typography.section, fontWeight: '700', maxWidth: spacing.xxl + spacing.md, textAlign: 'right' },
    planButton: { minHeight: layout.minTouchTarget, minWidth: control.inputHeight, maxWidth: control.inputHeight + spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xxs },
    planText: { color: colors.onPrimary, fontWeight: '800', flexShrink: 1 },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
