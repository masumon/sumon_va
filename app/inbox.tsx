import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { asciiDigitsToBengali } from '../src/services/debt/money';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { planInboxTasks } from '../src/services/planning-service';
import { useTaskStore } from '../src/store/task.store';
import { useMemoryStore } from '../src/store/memory.store';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppState } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { AppIcon } from '../src/ui/AppIcon';
import { RowLeading } from '../src/ui/RowLeading';
import { loadImageThumbs } from '../src/services/attachment-thumbs';
import { formatBangladeshTime } from '../src/i18n/date-time';
import { control, elevation, icon, layout, opacity, radius, spacing, typography, priorityAccentName, type ThemeAccents, type ThemeColors } from '../src/theme';
import type { Task } from '../src/types/task-model';
import { openTaskPreview } from '../src/ui/ItemPreviews';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

function tomorrow(): Date { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + 1); return d; }
function capturedLabel(iso: string, language: 'bn' | 'en'): string { try { return formatBangladeshTime(iso, language); } catch { return ''; } }

export default function InboxScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { showSnackbar } = useAppFeedback();
  const { tasks, isLoading, error, load, update, remove } = useTaskStore();
  const createMemory = useMemoryStore(s => s.create);
  const removeMemory = useMemoryStore(s => s.remove);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);

  useEffect(() => { void load(db); }, [db, load]);
  const inbox = useMemo(() => tasks.filter(task => task.status === 'INBOX'), [tasks]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const inboxIdKey = inbox.map(t => t.id).join(',');
  useEffect(() => {
    let alive = true;
    loadImageThumbs(db, 'TASK', inboxIdKey ? inboxIdKey.split(',') : [])
      .then(map => { if (alive) setThumbs(map); })
      .catch(() => { if (alive) setThumbs(new Map()); });
    return () => { alive = false; };
  }, [db, inboxIdKey]);

  const c = useMemo(() => (bn
    ? { eyebrow: 'দ্রুত লেখা', title: 'ইনবক্স', subtitle: 'তাড়াহুড়োয় যা লিখে রেখেছেন, কিন্তু এখনও গুছিয়ে নেননি।', banner: (n: number) => `${asciiDigitsToBengali(String(n))}টি জিনিস গোছানোর অপেক্ষায়`, clear: 'ইনবক্স খালি', clearText: 'মাথায় যা আসে সাথে সাথে এখানে লিখে রাখুন — যেমন “বসকে কল করতে হবে”, “নতুন একটা আইডিয়া”, “ওষুধ কিনতে হবে”। পরে একটা একটা করে কাজ বা মেমোরিতে সরিয়ে নিন।', captured: 'লেখা হয়েছে', toTask: 'কাজে নিন', toMemory: 'মনে রাখুন', later: 'পরে', del: 'মুছুন', processAll: (n: number) => `সব গুছিয়ে নিন (${asciiDigitsToBengali(String(n))})`, retry: 'আবার চেষ্টা করুন', taskDone: 'আজকের পরিকল্পনায় যোগ হয়েছে', memDone: 'মেমোরিতে রাখা হয়েছে', laterDone: 'কালকের জন্য রাখা হয়েছে', failed: 'কাজটা হলো না', delTitle: 'এটি মুছবেন?', delDesc: 'একবার মুছলে আর ফেরানো যাবে না।', delOk: 'মুছুন', cancel: 'বাতিল', add: 'নতুন', howTitle: 'ইনবক্স কীভাবে কাজে লাগে', howBody: 'ব্যস্ত থাকলে শুধু এক লাইন লিখে রাখুন। হাতে সময় এলে প্রতিটিতে “কাজে নিন” (পরিকল্পনায় চলে যাবে), “মনে রাখুন” (মেমোরি হবে) বা “পরে” চাপুন।', examples: ['বসকে কল করতে হবে', 'নতুন একটা আইডিয়া', 'ওষুধ কিনতে হবে'] }
    : { eyebrow: 'QUICK CAPTURE', title: 'Inbox', subtitle: 'Things you jotted down in a hurry but haven’t sorted yet.', banner: (n: number) => `${n} to sort out`, clear: 'Inbox is empty', clearText: 'Drop anything on your mind here as it comes up — like “call the boss”, “a new idea”, “buy medicine”. Sort each one into a task or a memory when you have a moment.', captured: 'Added', toTask: 'Make a task', toMemory: 'Keep as memory', later: 'Later', del: 'Delete', processAll: (n: number) => `Sort all (${n})`, retry: 'Retry', taskDone: 'Added to today’s plan', memDone: 'Kept as a memory', laterDone: 'Kept for tomorrow', failed: 'That didn’t work', delTitle: 'Delete this?', delDesc: 'Once it’s gone, it’s gone.', delOk: 'Delete', cancel: 'Cancel', add: 'New', howTitle: 'What the inbox is for', howBody: 'When you’re busy, just write one line. Later, on each item tap “Make a task” (it goes to your plan), “Keep as memory”, or “Later”.', examples: ['call the boss', 'a new idea', 'buy medicine'] }), [bn]);

  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(timer); }, [undo]);
  const runUndo = useCallback(async () => {
    if (!undo || busyId || bulkBusy) return;
    const action = undo; setUndo(null); setBulkBusy(true);
    try { await action.run(); await load(db); showSnackbar(bn ? 'ফিরিয়ে আনা হয়েছে' : 'Undone', 'success'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBulkBusy(false); }
  }, [undo, busyId, bulkBusy, load, db, showSnackbar, bn, c.failed]);

  const run = useCallback(async (id: string, fn: () => Promise<unknown>, okMsg: string, makeUndo?: () => Promise<unknown>) => {
    if (busyId || bulkBusy) return;
    setBusyId(id);
    try { await fn(); await load(db); showSnackbar(okMsg, 'success'); if (makeUndo) setUndo({ label: okMsg, run: makeUndo }); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBusyId(null); }
  }, [busyId, bulkBusy, load, db, showSnackbar, c.failed]);

  const toTask = useCallback((t: Task) => run(t.id, () => planInboxTasks(db, [t.id]), c.taskDone, () => update(db, t.id, { status: 'INBOX', plannedDate: null, dueAt: null })), [run, db, c.taskDone, update]);
  const toLater = useCallback((t: Task) => run(t.id, () => planInboxTasks(db, [t.id], tomorrow()), c.laterDone, () => update(db, t.id, { status: 'INBOX', plannedDate: null, dueAt: null })), [run, db, c.laterDone, update]);
  const toMemory = useCallback(async (t: Task) => {
    if (busyId || bulkBusy) return;
    setBusyId(t.id);
    try {
      const m = await createMemory(db, { content: t.title });
      if (!m) throw new Error('memory');
      await remove(db, t.id);
      await load(db);
      showSnackbar(c.memDone, 'success');
      // Undo deletes the exact memory we just made (by id — not a fragile content match)
      // and re-adds the item to the inbox. Attachments on the original are not recoverable.
      setUndo({ label: c.memDone, run: async () => {
        await removeMemory(db, m.id);
        await useTaskStore.getState().create(db, { title: t.title, priority: t.priority, notes: t.notes });
      } });
    } catch { showSnackbar(c.failed, 'danger'); }
    finally { setBusyId(null); }
  }, [busyId, bulkBusy, db, createMemory, remove, removeMemory, load, showSnackbar, c.memDone, c.failed]);
  const onDeleteRow = useCallback((t: Task) => setPendingDelete(t), []);
  const toggleOne = useCallback((id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const exitSelect = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const enterSelect = useCallback((id: string) => { setSelectMode(true); setSelected(new Set([id])); }, []);
  const bulkToTasks = useCallback(async () => {
    const ids = [...selected]; exitSelect();
    if (!ids.length || bulkBusy || busyId) return;
    setUndo(null); setBulkBusy(true);
    try { await planInboxTasks(db, ids); await load(db); showSnackbar(c.taskDone, 'success'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBulkBusy(false); }
  }, [selected, exitSelect, bulkBusy, busyId, db, load, showSnackbar, c.taskDone, c.failed]);
  const bulkDelete = useCallback(async () => {
    const ids = [...selected]; exitSelect(); setConfirmBulkDel(false);
    if (!ids.length || bulkBusy || busyId) return;
    setUndo(null); setBulkBusy(true);
    try { for (const id of ids) { try { await remove(db, id); } catch { /* skip one */ } } await load(db); showSnackbar(bn ? `${bnNum(ids.length)}টি মুছে ফেলা হয়েছে` : `${bnNum(ids.length)} deleted`, 'success'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBulkBusy(false); }
  }, [selected, exitSelect, bulkBusy, busyId, db, remove, load, showSnackbar, bn, c.failed]);
  const renderRow = useCallback(({ item }: { item: Task }) => {
    if (selectMode) return <SelectableInboxRow task={item} checked={selected.has(item.id)} onToggle={toggleOne} styles={styles} colors={colors} accents={accents} bn={bn} />;
    return <InboxRow task={item} busy={busyId === item.id} styles={styles} colors={colors} accents={accents} language={language} bn={bn} c={c} thumbUri={thumbs.get(item.id)} onTask={toTask} onMemory={toMemory} onLater={toLater} onDelete={onDeleteRow} onLongPress={enterSelect} />;
  }, [selectMode, selected, toggleOne, enterSelect, busyId, styles, colors, accents, language, bn, c, thumbs, toTask, toMemory, toLater, onDeleteRow]);
  const doDelete = async () => {
    if (!pendingDelete || busyId || bulkBusy) return;
    const id = pendingDelete.id; setPendingDelete(null); setBusyId(id);
    try { await remove(db, id); await load(db); } catch { showSnackbar(c.failed, 'danger'); } finally { setBusyId(null); }
  };
  const processAll = async () => {
    if (!inbox.length || bulkBusy || busyId) return;
    setUndo(null);
    setBulkBusy(true);
    try { await planInboxTasks(db, inbox.map(t => t.id)); await load(db); showSnackbar(c.taskDone, 'success'); }
    catch { showSnackbar(c.failed, 'danger'); }
    finally { setBulkBusy(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={styles.eyebrow}>{c.eyebrow}</Text>
            <Text style={styles.title}>{c.title}</Text>
          </View>
          {inbox.length ? <View style={styles.count}><Text style={styles.countText}>{bn ? bnNum(inbox.length) : inbox.length}</Text></View> : null}
        </View>
        <Text style={styles.subtitle}>{c.subtitle}</Text>
      </View>

      <View style={styles.how}>
        <View style={styles.howHead}>
          <AppIcon name="lightbulb-on-outline" size={icon.sm} color={accents.yellow.on} />
          <Text style={styles.howTitle}>{c.howTitle}</Text>
        </View>
        <Text style={styles.howBody}>{c.howBody}</Text>
        <View style={styles.howChips}>
          {c.examples.map(ex => (
            <View key={ex} style={styles.howChip}>
              <Text style={styles.howChipLabel}>{bn ? 'যেমন' : 'e.g.'}</Text>
              <Text numberOfLines={1} style={styles.howChipText}>{ex}</Text>
            </View>
          ))}
        </View>
      </View>

      {selectMode ? (
        <View style={styles.selectBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={c.cancel} onPress={exitSelect} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, pressed && styles.pressed])}>
            <AppIcon name="close" size={icon.sm} color={colors.textSecondary} /><Text style={styles.selectBarText}>{bn ? 'সম্পন্ন' : 'Done'}</Text>
          </Pressable>
          <Text style={styles.selectCount}>{selected.size} {bn ? 'নির্বাচিত' : 'selected'}</Text>
          <View style={styles.selectBarActions}>
            <Pressable accessibilityRole="button" disabled={!selected.size || bulkBusy} accessibilityLabel={c.toTask} onPress={() => void bulkToTasks()} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, (!selected.size || bulkBusy) && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="calendar-check-outline" size={icon.sm} color={colors.primary} /><Text style={styles.selectBarText}>{bn ? 'কাজে নিন' : 'Make tasks'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!selected.size || bulkBusy} accessibilityLabel={c.del} onPress={() => setConfirmBulkDel(true)} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, (!selected.size || bulkBusy) && styles.disabled, pressed && styles.pressed])}>
              <AppIcon name="delete-outline" size={icon.sm} color={colors.danger} /><Text style={[styles.selectBarText, { color: colors.danger }]}>{c.del}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <AppState title={bn ? 'ইনবক্স লোড করা যায়নি' : 'Could not load inbox'} description={bn ? 'ডেটা লোড করতে আবার চেষ্টা করুন।' : 'Unable to load local inbox data.'} icon="alert-circle-outline" actionLabel={c.retry} onAction={() => void load(db)} />
      ) : isLoading && !inbox.length ? (
        <AppState loading title={bn ? 'ইনবক্স লোড হচ্ছে…' : 'Loading inbox…'} />
      ) : (
        <FlatList
          data={inbox}
          extraData={selectMode ? selected : null}
          keyExtractor={item => item.id}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={inbox.length ? styles.list : styles.emptyList}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={inbox.length ? (
            <View style={styles.banner}>
              <View style={styles.bannerIcon}><AppIcon name="inbox-multiple-outline" size={icon.md} color={accents.purple.on} /></View>
              <Text style={styles.bannerText}>{c.banner(inbox.length)}</Text>
            </View>
          ) : null}
          ListEmptyComponent={<AppState icon="check-circle-outline" title={c.clear} description={c.clearText} />}
          ListFooterComponent={!selectMode && inbox.length > 1 ? (
            <Pressable accessibilityRole="button" accessibilityState={{ busy: bulkBusy }} onPress={() => void processAll()} style={({ pressed }) => StyleSheet.flatten([styles.processAll, bulkBusy && styles.disabled, pressed && styles.pressed])}>
              {bulkBusy ? <ActivityIndicator color={colors.onPrimary} /> : <><AppIcon name="checkbox-multiple-marked-outline" size={icon.sm} color={colors.onPrimary} /><Text style={styles.processAllText}>{c.processAll(inbox.length)}</Text></>}
            </Pressable>
          ) : null}
          renderItem={renderRow}
        />
      )}

      {undo ? (
        <View style={styles.undoBar}>
          <Text numberOfLines={1} style={styles.undoText}>{undo.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={bn ? 'ফিরিয়ে আনুন' : 'Undo'} onPress={() => void runUndo()} style={({ pressed }) => StyleSheet.flatten([styles.undoBtn, pressed && styles.pressed])}>
            <AppIcon name="undo-variant" size={icon.sm} color={colors.onPrimary} />
            <Text style={styles.undoBtnText}>{bn ? 'ফিরিয়ে আনুন' : 'Undo'}</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={c.add}
        onPress={() => router.push('/task-editor')}
        style={({ pressed }) => StyleSheet.flatten([styles.fab, pressed && styles.pressed])}
      >
        <AppIcon name="plus" size={icon.lg} color={colors.onPrimary} />
      </Pressable>

      <AppConfirmDialog
        visible={Boolean(pendingDelete)}
        title={c.delTitle}
        description={pendingDelete?.title ?? c.delDesc}
        confirmLabel={c.delOk}
        cancelLabel={c.cancel}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void doDelete()}
      />

      <AppConfirmDialog
        visible={confirmBulkDel}
        title={bn ? `${selected.size}টি মুছবেন?` : `Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        description={c.delDesc}
        confirmLabel={c.delOk}
        cancelLabel={c.cancel}
        danger
        onCancel={() => setConfirmBulkDel(false)}
        onConfirm={() => void bulkDelete()}
      />
    </View>
  );
}

const SelectableInboxRow = memo(function SelectableInboxRow({ task, checked, onToggle, styles, colors, accents, bn }: {
  task: Task; checked: boolean; onToggle: (id: string) => void; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; bn: boolean;
}) {
  const tone = accents[priorityAccentName(task.priority)];
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={task.title}
      onPress={() => onToggle(task.id)}
      style={({ pressed }) => StyleSheet.flatten([styles.selRow, checked && styles.selRowOn, pressed && styles.pressed])}
    >
      <AppIcon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={icon.md} color={checked ? colors.primary : colors.textMuted} />
      <View style={[styles.selRowBar, { backgroundColor: tone.base }]} />
      <Text numberOfLines={2} style={styles.selRowText}>{task.title}</Text>
    </Pressable>
  );
});

type InboxRowCopy = { captured: string; toTask: string; toMemory: string; later: string; del: string };

const InboxRow = memo(function InboxRow({ task, busy, styles, colors, accents, language, bn, c, thumbUri, onTask, onMemory, onLater, onDelete, onLongPress }: {
  task: Task; busy: boolean; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; language: 'bn' | 'en'; bn: boolean; c: InboxRowCopy; thumbUri?: string;
  onTask: (t: Task) => void; onMemory: (t: Task) => void; onLater: (t: Task) => void; onDelete: (t: Task) => void; onLongPress?: (id: string) => void;
}) {
  const tone = accents[priorityAccentName(task.priority)];
  return (
    <View style={styles.card}>
      <View style={[styles.priorityBar, { backgroundColor: tone.base }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeadRow}>
          <RowLeading thumbUri={thumbUri} icon="inbox-arrow-down-outline" tone="orange" size={40} />
          
            <Pressable onPress={() => openTaskPreview(task)}  accessibilityRole="button" accessibilityHint={bn ? 'একটানা চেপে ধরলে একাধিক নির্বাচন' : 'Long-press to select multiple'} accessibilityLabel={`${bn ? 'খুলুন' : 'Open'}: ${task.title}`} onLongPress={onLongPress ? () => onLongPress(task.id) : undefined} delayLongPress={350} style={({ pressed }) => StyleSheet.flatten([styles.cardTap, pressed && styles.pressed])}>
              <Text numberOfLines={3} style={styles.cardTitle}>{task.title}</Text>
              <Text style={styles.cardMeta}>{c.captured}: {capturedLabel(task.createdAt, language)}</Text>
            </Pressable>
        </View>
        {busy ? (
          <View style={styles.actionRowBusy}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${c.toTask}: ${task.title}`} onPress={() => void onTask(task)} style={({ pressed }) => StyleSheet.flatten([styles.actBtn, styles.actPrimary, pressed && styles.pressed])}>
              <AppIcon name="calendar-check-outline" size={icon.xs} color={accents.green.on} />
              <Text numberOfLines={1} style={[styles.actText, { color: accents.green.on }]}>{c.toTask}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${c.toMemory}: ${task.title}`} onPress={() => void onMemory(task)} style={({ pressed }) => StyleSheet.flatten([styles.actBtn, styles.actMemory, pressed && styles.pressed])}>
              <AppIcon name="bookmark-plus-outline" size={icon.xs} color={accents.purple.on} />
              <Text numberOfLines={1} style={[styles.actText, { color: accents.purple.on }]}>{c.toMemory}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${c.later}: ${task.title}`} onPress={() => void onLater(task)} style={({ pressed }) => StyleSheet.flatten([styles.actBtn, pressed && styles.pressed])}>
              <AppIcon name="clock-outline" size={icon.xs} color={colors.textSecondary} />
              <Text numberOfLines={1} style={[styles.actText, { color: colors.textSecondary }]}>{c.later}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${c.del}: ${task.title}`} onPress={() => onDelete(task)} style={({ pressed }) => StyleSheet.flatten([styles.actIcon, pressed && styles.pressed])}>
              <AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
});

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.smd },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    titleCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, marginTop: spacing.xxs },
    count: { minWidth: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
    countText: { color: colors.onPrimary, ...typography.meta, fontFamily: typography.numeric.fontFamily },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.sm },
    how: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: accents.yellow.border, backgroundColor: accents.yellow.soft, borderRadius: radius.lg, padding: spacing.smd, gap: spacing.xs },
    howHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    howTitle: { color: accents.yellow.on, ...typography.caption, fontFamily: typography.label.fontFamily, letterSpacing: 0.4 },
    howBody: { color: colors.textSecondary, ...typography.caption, lineHeight: 17 },
    howChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xxs },
    howChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: accents.yellow.border },
    howChipLabel: { color: accents.yellow.on, ...typography.caption, fontFamily: typography.label.fontFamily, fontSize: 10 },
    howChipText: { flexShrink: 1, color: colors.textPrimary, ...typography.caption },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + spacing.xl, gap: spacing.sm },
    emptyList: { flexGrow: 1, paddingHorizontal: spacing.lg },
    banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: accents.purple.soft, borderColor: accents.purple.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.smd, marginBottom: spacing.sm },
    bannerIcon: { width: control.listIconContainer, height: control.listIconContainer, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    bannerText: { flex: 1, color: accents.purple.on, ...typography.callout },
    card: { flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', ...elevation.soft },
    priorityBar: { width: 4, alignSelf: 'stretch' },
    cardBody: { flex: 1, minWidth: 0, padding: spacing.smd, gap: spacing.sm },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardTap: { flex: 1, minWidth: 0, minHeight: control.iconButtonSize, justifyContent: 'center' },
    cardTitle: { color: colors.textPrimary, ...typography.body, fontFamily: typography.cardTitle.fontFamily },
    cardMeta: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xxs },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    actionRowBusy: { minHeight: layout.minTouchTarget, alignItems: 'flex-start', justifyContent: 'center' },
    actBtn: { flex: 1, minWidth: 0, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    actPrimary: { backgroundColor: accents.green.soft, borderColor: accents.green.border },
    actMemory: { backgroundColor: accents.purple.soft, borderColor: accents.purple.border },
    actText: { ...typography.caption, fontFamily: typography.label.fontFamily },
    actIcon: { minHeight: layout.minTouchTarget, minWidth: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    processAll: { minHeight: control.buttonHeight, marginTop: spacing.smd, borderRadius: radius.md, backgroundColor: accents.purple.base, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, ...elevation.raised },
    processAllText: { color: colors.onPrimary, ...typography.callout, fontFamily: typography.label.fontFamily },
    fab: { position: 'absolute', right: spacing.lg, bottom: layout.compactNavHeight + spacing.xxl, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...elevation.floating },
    undoBar: { position: 'absolute', left: spacing.lg, right: spacing.lg + 56 + spacing.sm, bottom: layout.compactNavHeight + spacing.xxl, minHeight: control.buttonHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...elevation.floating },
    undoText: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.caption, fontWeight: '700' },
    undoBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.smd, borderRadius: radius.md, backgroundColor: colors.primary },
    undoBtnText: { color: colors.onPrimary, ...typography.caption, fontWeight: '700' },
    selectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    selectBarActions: { flexDirection: 'row', gap: spacing.xs },
    selectBarBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
    selectBarText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    selectCount: { flex: 1, textAlign: 'center', color: colors.textSecondary, ...typography.meta, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    selRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    selRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
    selRowBar: { width: 4, alignSelf: 'stretch', borderRadius: radius.pill },
    selRowText: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '600' },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
