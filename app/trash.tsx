import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { collectTrash, purgeTrashed, restoreTrashed, type TrashedItem } from '../src/services/trash-registry';
import { useAppPreferences } from '../src/app/AppPreferences';
import { useTaskStore } from '../src/store/task.store';
import { useMemoryStore } from '../src/store/memory.store';
import { listTrashedTasks, purgeTask, emptyTaskTrash, type TrashedTask } from '../src/services/task-repository';
import { listTrashedMemories, purgeMemory, emptyMemoryTrash, type TrashedMemory } from '../src/services/memory-repository';
import { AppIcon } from '../src/ui/AppIcon';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { AppState } from '../src/ui/AppSurface';
import { formatBangladeshRelativeDate } from '../src/i18n/date-time';
import { border, control, elevation, icon, layout, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../src/theme';
import { success, warn } from '../src/ui/haptics';

const RETENTION_DAYS = 30;
// Two built-in tabs plus one per module that reports trash, so a module added later gets
// the safety net without an edit here.
type Tab = 'tasks' | 'memories' | 'modules';

export default function TrashScreen() {
  const db = useSQLiteContext();
  const { colors, accents, language } = useAppPreferences();
  const { showSnackbar } = useAppFeedback();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const restoreTask = useTaskStore(s => s.restore);
  const untrashMemory = useMemoryStore(s => s.untrash);
  const [tab, setTab] = useState<Tab>('tasks');
  // A ref, not state: the reload callback reads it without being rebuilt by it.
  const tabPicked = useRef(false);
  const [tasks, setTasks] = useState<TrashedTask[]>([]);
  const [memories, setMemories] = useState<TrashedMemory[]>([]);
  const [moduleItems, setModuleItems] = useState<TrashedItem[]>([]);
  const [ready, setReady] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // "Delete forever" on one row asks first, like "Empty trash" does — it cannot be undone.
  const [confirmPurge, setConfirmPurge] = useState<{ kind: 'task' | 'memory' | 'module'; id: string; item?: TrashedItem } | null>(null);

  const reload = useCallback(
    () => Promise.all([listTrashedTasks(db), listTrashedMemories(db), collectTrash(db, language).catch(() => [])])
      .then(([t, m, mods]) => {
        setTasks(t); setMemories(m); setModuleItems(mods);
        // Land on a tab that has something in it. Opening on "tasks" when the only thing
        // deleted was a debt showed an empty bin to somebody who came to undo something.
        if (!tabPicked.current) {
          setTab(t.length ? 'tasks' : m.length ? 'memories' : mods.length ? 'modules' : 'tasks');
        }
      })
      .catch(() => { /* keep the last good list */ })
      .finally(() => setReady(true)),
    [db, language],
  );
  useEffect(() => { void reload(); }, [reload]);

  const c = bn
    ? { back: 'ফিরুন', eyebrow: 'মুছে ফেলা', title: 'মুছে ফেলা জিনিস', sub: `মুছে ফেলা জিনিস ${String(RETENTION_DAYS).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!)} দিন এখানে থাকে, তারপর নিজে থেকেই মুছে যায়।`, tasks: 'কাজ', memories: 'মেমোরি', other: 'অন্যান্য', restore: 'ফিরিয়ে আনুন', forever: 'স্থায়ীভাবে মুছুন', empty: 'সব খালি করুন', none: 'এখানে কিছু নেই', purgeTitle: 'স্থায়ীভাবে মুছবেন?', purgeDesc: 'এটি এই ফোন থেকে চিরতরে মুছে যাবে, আর ফেরানো যাবে না।', emptyTitle: 'সব স্থায়ীভাবে মুছবেন?', emptyDesc: 'এখানকার সব কিছু এই ফোন থেকে চিরতরে মুছে যাবে।', ok: 'মুছুন', cancel: 'বাতিল', deleted: 'মুছে ফেলা হয়েছে', restored: 'ফিরিয়ে আনা হয়েছে', restoreFailed: 'ফেরানো যায়নি', purged: 'স্থায়ীভাবে মুছে ফেলা হয়েছে', purgeFailed: 'মোছা যায়নি', emptied: 'সব খালি করা হয়েছে', emptyFailed: 'খালি করা যায়নি' }
    : { back: 'Back', eyebrow: 'DELETED', title: 'Deleted items', sub: `Deleted items stay here for ${RETENTION_DAYS} days, then clear themselves.`, tasks: 'Tasks', memories: 'Memories', other: 'Other', restore: 'Restore', forever: 'Delete forever', empty: 'Empty all', none: 'Nothing here', purgeTitle: 'Delete for good?', purgeDesc: 'This is removed from this device permanently and cannot be restored.', emptyTitle: 'Delete everything for good?', emptyDesc: 'Everything here is removed from this device permanently.', ok: 'Delete', cancel: 'Cancel', deleted: 'Deleted', restored: 'Restored', restoreFailed: 'Could not restore', purged: 'Deleted forever', purgeFailed: 'Could not delete', emptied: 'All emptied', emptyFailed: 'Could not empty it' };

  // Every action below used to reload the list and say nothing else — a tap that failed
  // (or one that simply hadn't finished yet) looked identical to one that worked, which is
  // exactly the wrong place for that ambiguity: this screen exists so an accidental delete
  // has a way back, and a silent failure here is a way back that quietly doesn't work.
  const onRestoreTask = async (id: string) => {
    const ok = await restoreTask(db, id).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.restored : c.restoreFailed, ok ? 'success' : 'danger');
    await reload();
  };
  const onPurgeTask = async (id: string) => {
    const ok = await purgeTask(db, id).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.purged : c.purgeFailed, ok ? 'success' : 'danger');
    await reload();
  };
  const onRestoreMemory = async (id: string) => {
    const ok = await untrashMemory(db, id).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.restored : c.restoreFailed, ok ? 'success' : 'danger');
    await reload();
  };
  const onPurgeMemory = async (id: string) => {
    const ok = await purgeMemory(db, id).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.purged : c.purgeFailed, ok ? 'success' : 'danger');
    await reload();
  };
  const onRestoreModule = async (item: TrashedItem) => {
    const ok = await restoreTrashed(db, item).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.restored : c.restoreFailed, ok ? 'success' : 'danger');
    await reload();
  };
  const onPurgeModule = async (item: TrashedItem) => {
    const ok = await purgeTrashed(db, item).catch(() => false);
    if (ok) success(); else warn();
    showSnackbar(ok ? c.purged : c.purgeFailed, ok ? 'success' : 'danger');
    await reload();
  };

  const onConfirmPurge = async () => {
    const target = confirmPurge;
    setConfirmPurge(null);
    if (!target) return;
    if (target.kind === 'module' && target.item) await onPurgeModule(target.item);
    else if (target.kind === 'task') await onPurgeTask(target.id);
    else if (target.kind === 'memory') await onPurgeMemory(target.id);
  };

  const onEmpty = async () => {
    setConfirmEmpty(false);
    // "Everything" includes every module's items, not only tasks and memories — the
    // dialog says so. One item that cannot go must not stop the rest.
    const emptyModules = async () => {
      let failed = 0;
      for (const item of moduleItems) {
        try { if (!(await purgeTrashed(db, item))) failed += 1; } catch { failed += 1; }
      }
      return failed;
    };
    const result = await Promise.all([emptyTaskTrash(db), emptyMemoryTrash(db)])
      .then(async (done) => ((await emptyModules()) === 0 ? done : null))
      .catch(() => null);
    if (result) success(); else warn();
    showSnackbar(result ? c.emptied : c.emptyFailed, result ? 'success' : 'danger');
    await reload();
  };

  const total = tasks.length + memories.length + moduleItems.length;
  const rows = tab === 'tasks' ? tasks : tab === 'memories' ? memories : moduleItems;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}>
          <AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{c.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{c.title}</Text>
        <Text style={styles.sub}>{c.sub}</Text>
      </View>

      <View style={styles.tabs}>
        {(['tasks', 'memories', 'modules'] as const)
          // The modules tab only appears once a module has something in it — an empty
          // third tab on a fresh install is a question the user cannot answer.
          .filter(t => t !== 'modules' || moduleItems.length > 0)
          .map(t => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => { tabPicked.current = true; setTab(t); }} style={({ pressed }) => StyleSheet.flatten([styles.tab, tab === t && styles.tabOn, pressed && styles.pressed])}>
              <Text numberOfLines={1} style={[styles.tabText, tab === t && styles.tabTextOn]}>
                {t === 'tasks' ? c.tasks : t === 'memories' ? c.memories : c.other} · {t === 'tasks' ? tasks.length : t === 'memories' ? memories.length : moduleItems.length}
              </Text>
            </Pressable>
          ))}
      </View>

      {!ready ? null : total === 0 ? (
        <AppState icon="delete-empty-outline" title={c.none} />
      ) : rows.length === 0 ? (
        <AppState icon="delete-empty-outline" title={c.none} />
      ) : (
        <>
          {rows.map((row) => {
            const isTask = tab === 'tasks';
            const isModule = tab === 'modules';
            const label = isModule
              ? (row as TrashedItem).title
              : isTask ? (row as TrashedTask).title : ((row as TrashedMemory).title || (row as TrashedMemory).content);
            return (
              <View key={row.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <AppIcon
                    name={isModule ? ((row as TrashedItem).icon ?? 'delete-outline') : isTask ? 'clipboard-text-outline' : 'bookmark-outline'}
                    size={icon.sm}
                    color={colors.textMuted}
                  />
                  <Text numberOfLines={2} style={styles.cardTitle}>{label}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {isModule && (row as TrashedItem).subtitle ? `${(row as TrashedItem).subtitle} · ` : ''}
                  {c.deleted} {formatBangladeshRelativeDate(row.deletedAt, language)}
                </Text>
                <View style={styles.cardActions}>
                  <Pressable accessibilityRole="button" onPress={() => void (isModule ? onRestoreModule(row as TrashedItem) : isTask ? onRestoreTask(row.id) : onRestoreMemory(row.id))} style={({ pressed }) => StyleSheet.flatten([styles.actBtn, pressed && styles.pressed])}>
                    <AppIcon name="backup-restore" size={icon.xs} color={colors.primary} /><Text style={styles.actText}>{c.restore}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setConfirmPurge(isModule ? { kind: 'module', id: row.id, item: row as TrashedItem } : { kind: isTask ? 'task' : 'memory', id: row.id })} style={({ pressed }) => StyleSheet.flatten([styles.actBtn, pressed && styles.pressed])}>
                    <AppIcon name="delete-forever-outline" size={icon.xs} color={colors.danger} /><Text style={[styles.actText, { color: colors.danger }]}>{c.forever}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => setConfirmEmpty(true)} style={({ pressed }) => StyleSheet.flatten([styles.emptyBtn, pressed && styles.pressed])}>
            <AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} /><Text style={styles.emptyBtnText}>{c.empty}</Text>
          </Pressable>
        </>
      )}

      <AppConfirmDialog visible={confirmPurge !== null} title={c.purgeTitle} description={c.purgeDesc} confirmLabel={c.ok} cancelLabel={c.cancel} danger onCancel={() => setConfirmPurge(null)} onConfirm={() => void onConfirmPurge()} />
      <AppConfirmDialog visible={confirmEmpty} title={c.emptyTitle} description={c.emptyDesc} confirmLabel={c.ok} cancelLabel={c.cancel} danger onCancel={() => setConfirmEmpty(false)} onConfirm={() => void onEmpty()} />
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
    tabs: { flexDirection: 'row', gap: spacing.xs, padding: spacing.xxs, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, marginBottom: spacing.md },
    tab: { flex: 1, minHeight: layout.minTouchTarget, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.primary },
    tabText: { color: colors.textSecondary, ...typography.meta, fontWeight: '800' },
    tabTextOn: { color: colors.onPrimary },
    card: { borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, marginBottom: spacing.sm, ...elevation.soft },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    cardTitle: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    cardMeta: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xs },
    cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.sm },
    actBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
    actText: { color: colors.primary, ...typography.caption, fontWeight: '800' },
    emptyBtn: { minHeight: control.buttonHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.danger, backgroundColor: colors.surface, marginTop: spacing.md },
    emptyBtnText: { color: colors.danger, ...typography.bodySmall, fontWeight: '800' },
    pressed: { opacity: 0.78 },
  });
}
