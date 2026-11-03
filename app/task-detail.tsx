import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useTaskStore } from '../src/store/task.store';
import { ALLOWED_TRANSITIONS, getTask } from '../src/services/task-service';
import type { Task } from '../src/types/task-model';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { AppIcon } from '../src/ui/AppIcon';
import { success, warn } from '../src/ui/haptics';
import { AttachmentPanel } from '../src/ui/AttachmentPanel';
import { SubtaskList } from '../src/ui/SubtaskList';
import { findMemories } from '../src/services/memory-service';
import { linkTaskMemory, unlinkTaskMemory, listLinkedMemories } from '../src/services/relation-service';
import type { Memory } from '../src/types/memory-model';
import { formatBangladeshWeekdayDate, formatBangladeshDateTime } from '../src/i18n/date-time';
import { localizeTaskPriority, localizeTaskStatus } from '../src/i18n/domain-labels';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, priorityAccentName, memoryKindIcon, type ThemeAccents, type ThemeColors } from '../src/theme';
import type { TaskStatus } from '../src/types';

function dateLabel(v: string | null | undefined, language: 'bn' | 'en'): string | null { if (!v) return null; try { return v.length <= 10 ? formatBangladeshWeekdayDate(`${v}T00:00:00`, language) : formatBangladeshDateTime(v, language); } catch { return v; } }

export default function TaskDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { showSnackbar } = useAppFeedback();
  const { tasks, load, update, remove, restore, skipOccurrence } = useTaskStore();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fetched, setFetched] = useState<Task | null>(null);
  // Prefer the shared store (instant), but fall back to a direct fetch so a filtered /
  // stale list never makes an existing task look "not found" (e.g. opened from a reminder).
  const task = tasks.find(t => t.id === id) ?? (fetched?.id === id ? fetched : null);
  const [related, setRelated] = useState<Memory[]>([]);
  const [linked, setLinked] = useState<Memory[]>([]);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  const refreshLinks = useCallback(async () => {
    if (!id) { setLinked([]); return; }
    try { setLinked(await listLinkedMemories(db, id)); } catch { setLinked([]); }
  }, [db, id]);

  useEffect(() => {
    if (task) { void Promise.resolve().then(() => setLoaded(true)); return; }
    let active = true;
    void Promise.all([load(db), id ? getTask(db, id).catch(() => null) : Promise.resolve(null)])
      .then(([, direct]) => { if (active && direct) setFetched(direct); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [db, load, task, id]);
  useEffect(() => { void Promise.resolve().then(() => refreshLinks()); }, [refreshLinks]);
  useEffect(() => {
    const title = task?.title?.trim();
    const linkedIds = new Set(linked.map(m => m.id));
    let active = true;
    void Promise.resolve()
      .then(() => (title && title.length >= 3 ? findMemories(db, title) : []))
      .then(rows => { if (active) setRelated(rows.filter(m => !linkedIds.has(m.id)).slice(0, 3)); })
      .catch(() => { if (active) setRelated([]); });
    return () => { active = false; };
  }, [db, task?.title, linked]);


  const c = bn
    ? { back: 'ফিরুন', badge: 'কাজের বিস্তারিত', date: 'তারিখ', due: 'নির্ধারিত সময়', planned: 'পরিকল্পিত', status: 'অবস্থা', note: 'নোট', noNote: '—', attachments: 'সংযুক্ত ফাইল', complete: 'সম্পন্ন করুন', reopen: 'আবার খুলুন', edit: 'সম্পাদনা', toInbox: 'ইনবক্সে পাঠান', share: 'শেয়ার', del: 'মুছুন', notFound: 'কাজ পাওয়া যায়নি', done: 'সম্পন্ন হয়েছে', reopened: 'আবার খোলা হয়েছে', movedInbox: 'ইনবক্সে পাঠানো হয়েছে', failed: 'কাজটি সম্পন্ন হয়নি', delTitle: 'কাজ মুছবেন?', delDesc: 'এই ফোন থেকে কাজটি স্থায়ীভাবে মুছে যাবে।', delOk: 'মুছুন', cancel: 'বাতিল', skipOne: 'এইবারেরটা বাদ দিন', skipped: 'পরের বারের জন্য সরানো হয়েছে', stopRepeat: 'পুনরাবৃত্তি বন্ধ', stoppedRepeat: 'আর পুনরাবৃত্তি হবে না' }
    : { back: 'Back', badge: 'TASK DETAIL', date: 'Date', due: 'Due', planned: 'Planned', status: 'Status', note: 'Note', noNote: '—', attachments: 'Attachments', complete: 'Mark complete', reopen: 'Reopen', edit: 'Edit', toInbox: 'Move to inbox', share: 'Share', del: 'Delete', notFound: 'Task not found', done: 'Marked complete', reopened: 'Reopened', movedInbox: 'Moved to inbox', failed: 'That action did not complete', delTitle: 'Delete task?', delDesc: 'This permanently removes the task from this device.', delOk: 'Delete', cancel: 'Cancel', skipOne: 'Skip this one', skipped: 'Moved to the next occurrence', stopRepeat: 'Stop repeating', stoppedRepeat: 'This task won’t repeat any more' };

  const mutate = async (patch: Parameters<typeof update>[2], okMsg: string) => {
    if (!id || busy) return;
    setBusy(true);
    try { const r = await update(db, id, patch); if (r) { success(); showSnackbar(okMsg, 'success'); } else showSnackbar(c.failed, 'danger'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!id || busy) return;
    const taskId = id;
    setBusy(true);
    try {
      if (await remove(db, taskId)) {
        router.replace('/planning');
        showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'info', { label: bn ? 'ফিরিয়ে আনুন' : 'Undo', onPress: () => void restore(db, taskId) });
      }
    } finally { setBusy(false); setConfirmDelete(false); }
  };
  const doShare = () => { if (task) void Share.share({ message: task.notes ? `${task.title}\n\n${task.notes}` : task.title }).catch(() => {}); };
  const doSkip = async () => {
    if (!id || busy) return;
    setBusy(true);
    try { const r = await skipOccurrence(db, id); if (r) { success(); showSnackbar(c.skipped, 'success'); } else showSnackbar(c.failed, 'danger'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBusy(false); }
  };
  const doLink = async (memoryId: string) => {
    if (!id || linkBusy) return;
    setLinkBusy(memoryId);
    try { await linkTaskMemory(db, id, memoryId); await refreshLinks(); } catch { showSnackbar(c.failed, 'danger'); }
    finally { setLinkBusy(null); }
  };
  const doUnlink = async (memoryId: string) => {
    if (!id || linkBusy) return;
    setLinkBusy(memoryId);
    try { await unlinkTaskMemory(db, id, memoryId); await refreshLinks(); } catch { showSnackbar(c.failed, 'danger'); }
    finally { setLinkBusy(null); }
  };

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!task) return (
    <View style={styles.center}>
      <View style={styles.notFoundIcon}><AppIcon name="clipboard-alert-outline" size={icon.xl} color={colors.warning} /></View>
      <Text style={styles.notFoundText}>{c.notFound}</Text>
      <Pressable onPress={() => router.push("/planning" as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.secondary, pressed && styles.pressed])}><Text style={styles.secondaryText}>{c.back}</Text></Pressable>
    </View>
  );

  const tone = accents[priorityAccentName(task.priority)];
  const isClosed = ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(task.status);
  const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
  // CANCELLED can't go straight to IN_PROGRESS — it reopens into the inbox.
  const reopenTarget: TaskStatus | null = allowed.includes('IN_PROGRESS') ? 'IN_PROGRESS' : allowed.includes('INBOX') ? 'INBOX' : null;
  const canToInbox = allowed.includes('INBOX');
  const planned = dateLabel(task.plannedDate, language);
  const due = dateLabel(task.dueAt, language);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/planning'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}><AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text></Pressable>
          <Pressable onPress={() => router.push({ pathname: '/task-editor', params: { id: task.id } } as never)}  accessibilityRole="button" accessibilityLabel={c.edit} style={({ pressed }) => StyleSheet.flatten([styles.editBtn, pressed && styles.pressed])}><AppIcon name="pencil-outline" size={icon.sm} color={colors.primary} /></Pressable>
        </View>

        <Text style={styles.badge}>{c.badge}</Text>
        <Text accessibilityRole="header" style={styles.title}>{task.title}</Text>
        <View style={[styles.priorityChip, { backgroundColor: tone.soft, borderColor: tone.border }]}>
          <View style={[styles.dot, { backgroundColor: tone.base }]} />
          <Text style={[styles.priorityChipText, { color: tone.on }]}>{localizeTaskPriority(task.priority, bn)}</Text>
        </View>

        <View style={styles.card}>
          {planned ? <Row icon="calendar-month-outline" label={c.planned} value={planned} styles={styles} colors={colors} /> : null}
          {due ? <Row icon="calendar-clock-outline" label={c.due} value={due} styles={styles} colors={colors} /> : null}
          <Row icon="progress-check" label={c.status} value={localizeTaskStatus(task.status, bn)} styles={styles} colors={colors} />
          <Row icon="text-long" label={c.note} value={task.notes?.trim() || c.noNote} styles={styles} colors={colors} multiline />
        </View>

        {id ? <SubtaskList taskId={id} onAllComplete={() => { if (!isClosed) void mutate({ status: 'COMPLETED' }, c.done); }} /> : null}
        {linked.length || related.length ? (
          <View style={styles.relatedWrap}>
            <Text style={styles.relatedTitle}>{bn ? 'সম্পর্কিত মেমোরি' : 'Related memories'}</Text>
            {linked.map(m => (
              <View key={m.id} style={styles.relatedRow}>
                <AppIcon name="link-variant" size={icon.sm} color={colors.primary} />
                <Pressable accessibilityRole="button" accessibilityLabel={m.content.slice(0, 60)} onPress={() => router.push({ pathname: '/memory-detail', params: { id: m.id } })} style={({ pressed }) => StyleSheet.flatten([styles.relatedTap, pressed && styles.pressed])}>
                  <Text numberOfLines={2} style={styles.relatedText}>{m.title || m.content}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'লিংক সরান' : 'Unlink'} disabled={linkBusy === m.id} onPress={() => void doUnlink(m.id)} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.linkBtn, pressed && styles.pressed])}>
                  {linkBusy === m.id ? <ActivityIndicator size="small" color={colors.textMuted} /> : <AppIcon name="link-variant-off" size={icon.sm} color={colors.textMuted} />}
                </Pressable>
              </View>
            ))}
            {related.length ? <Text style={styles.relatedHint}>{bn ? 'পরামর্শ — লিংক করতে + চাপুন' : 'Suggested — tap + to link'}</Text> : null}
            {related.map(m => (
              <View key={m.id} style={styles.relatedRow}>
                <AppIcon name={memoryKindIcon(m.kind)} size={icon.sm} color={colors.textMuted} />
                <Pressable accessibilityRole="button" accessibilityLabel={m.content.slice(0, 60)} onPress={() => router.push({ pathname: '/memory-detail', params: { id: m.id } })} style={({ pressed }) => StyleSheet.flatten([styles.relatedTap, pressed && styles.pressed])}>
                  <Text numberOfLines={2} style={styles.relatedText}>{m.title || m.content}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'লিংক করুন' : 'Link'} disabled={linkBusy === m.id} onPress={() => void doLink(m.id)} hitSlop={8} style={({ pressed }) => StyleSheet.flatten([styles.linkBtn, pressed && styles.pressed])}>
                  {linkBusy === m.id ? <ActivityIndicator size="small" color={colors.primary} /> : <AppIcon name="plus" size={icon.sm} color={colors.primary} />}
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {id ? <AttachmentPanel ownerType="TASK" ownerId={id} /> : null}

        {!isClosed ? (
          <Pressable accessibilityRole="button" accessibilityState={{ busy }} onPress={() => void mutate({ status: 'COMPLETED' }, c.done)} style={({ pressed }) => StyleSheet.flatten([styles.primary, busy && styles.disabled, pressed && styles.pressed])}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="check" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryText}>{c.complete}</Text></>}
          </Pressable>
        ) : (task.status === 'COMPLETED' || task.status === 'CANCELLED') && reopenTarget ? (
          <Pressable accessibilityRole="button" accessibilityState={{ busy }} onPress={() => void mutate({ status: reopenTarget }, c.reopened)} style={({ pressed }) => StyleSheet.flatten([styles.primary, busy && styles.disabled, pressed && styles.pressed])}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="backup-restore" size={icon.sm} color={colors.onPrimary} /><Text style={styles.primaryText}>{c.reopen}</Text></>}
          </Pressable>
        ) : null}

        {task.recurrence && !isClosed ? (
          <View style={styles.recurRow}>
            <Pressable accessibilityRole="button" accessibilityState={{ busy }} accessibilityLabel={c.skipOne} onPress={() => void doSkip()} style={({ pressed }) => StyleSheet.flatten([styles.ghost, styles.recurBtn, busy && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="skip-next-outline" size={icon.sm} color={colors.primary} /><Text style={styles.ghostText}>{c.skipOne}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ busy }} accessibilityLabel={c.stopRepeat} onPress={() => void mutate({ recurrence: null }, c.stoppedRepeat)} style={({ pressed }) => StyleSheet.flatten([styles.ghost, styles.recurBtn, busy && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="repeat-off" size={icon.sm} color={colors.primary} /><Text style={styles.ghostText}>{c.stopRepeat}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actionBar}>
          
            <Pressable onPress={() => router.push({ pathname: '/task-editor', params: { id: task.id } } as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="pencil-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.edit}</Text></Pressable>
          {task.status !== 'INBOX' && canToInbox ? (
            <Pressable accessibilityRole="button" onPress={() => void mutate({ status: 'INBOX' as TaskStatus }, c.movedInbox)} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="inbox-arrow-down-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.toInbox}</Text></Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={doShare} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="share-variant-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.share}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} /><Text style={[styles.barText, { color: colors.danger }]}>{c.del}</Text></Pressable>
        </View>
      </ScrollView>

      <AppConfirmDialog visible={confirmDelete} title={c.delTitle} description={c.delDesc} confirmLabel={c.delOk} cancelLabel={c.cancel} danger onCancel={() => setConfirmDelete(false)} onConfirm={() => { warn(); void doDelete(); }} />
    </View>
  );
}

function Row({ icon: iconName, label, value, styles, colors, multiline }: { icon: 'calendar-month-outline' | 'calendar-clock-outline' | 'progress-check' | 'text-long'; label: string; value: string; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; multiline?: boolean }) {
  return (
    <View style={[styles.row, multiline && styles.rowMultiline]}>
      <AppIcon name={iconName} size={icon.sm} color={colors.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, multiline && styles.rowValueMultiline]}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    notFoundIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.xl, backgroundColor: accents.orange.soft, alignItems: 'center', justifyContent: 'center' },
    notFoundText: { color: colors.textPrimary, ...typography.cardTitle },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontFamily: typography.label.fontFamily },
    editBtn: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    badge: { color: colors.textMuted, ...typography.section, letterSpacing: 0.8, marginTop: spacing.sm },
    title: { color: colors.textPrimary, ...typography.titleLarge, marginTop: spacing.xs },
    priorityChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.smd, paddingVertical: spacing.xxs, marginTop: spacing.smd },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    priorityChipText: { ...typography.caption, fontFamily: typography.label.fontFamily },
    card: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...elevation.soft },
    row: { minHeight: control.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: border.thin, borderBottomColor: colors.border },
    rowMultiline: { alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: 0 },
    rowLabel: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, width: 72 },
    rowValue: { flex: 1, color: colors.textPrimary, ...typography.bodySmall, textAlign: 'right' },
    rowValueMultiline: { textAlign: 'left', ...typography.body },
    primary: { minHeight: control.buttonHeight, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, ...elevation.raised },
    primaryText: { color: colors.onPrimary, ...typography.callout, fontFamily: typography.label.fontFamily },
    ghost: { minHeight: control.buttonHeight, marginTop: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    ghostText: { color: colors.primary, ...typography.callout, fontFamily: typography.label.fontFamily },
    recurRow: { flexDirection: 'row', gap: spacing.sm },
    recurBtn: { flex: 1, paddingHorizontal: spacing.xs },
    actionBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg, borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.md },
    relatedWrap: { marginTop: spacing.lg, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.xs },
    relatedTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700', marginBottom: spacing.xxs },
    relatedRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    relatedTap: { flex: 1, minWidth: 0, minHeight: layout.minTouchTarget, justifyContent: 'center' },
    relatedText: { color: colors.textSecondary, ...typography.bodySmall },
    relatedHint: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xs },
    linkBtn: { width: control.iconButtonSize, height: control.iconButtonSize, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    barBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
    barText: { color: colors.textSecondary, ...typography.meta, fontFamily: typography.label.fontFamily },
    secondary: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.textSecondary, ...typography.body, fontFamily: typography.label.fontFamily },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
