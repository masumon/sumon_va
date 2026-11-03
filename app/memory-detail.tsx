import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/ui/AppText';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemoryStore } from '../src/store/memory.store';
import { readMemory, findMemories } from '../src/services/memory-service';
import type { Memory } from '../src/types/memory-model';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { AppIcon } from '../src/ui/AppIcon';
import { AttachmentPanel } from '../src/ui/AttachmentPanel';
import { listLinkedTasks } from '../src/services/relation-service';
import type { Task } from '../src/types/task-model';
import { formatBangladeshDateTime } from '../src/i18n/date-time';
import { localizeMemoryKind } from '../src/i18n/domain-labels';
import { border, control, icon, layout, opacity, radius, spacing, typography, memoryKindAccentName, memoryKindIcon, type ThemeAccents, type ThemeColors } from '../src/theme';
import { tagLabel } from '../src/ui/TagSuggestions';

function ts(v: string | null | undefined, language: 'bn' | 'en'): string | null { if (!v) return null; try { return formatBangladeshDateTime(v, language); } catch { return v; } }

export default function MemoryDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const { showSnackbar } = useAppFeedback();
  const { memories, archive, restore, remove, untrash } = useMemoryStore();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fetched, setFetched] = useState<Memory | null>(null);
  // Fetch the memory directly by id (active OR archived). Reading it off the shared list
  // store used to race load()/loadArchived() and flash "not found" for archived memories.
  const memory = memories.find(m => m.id === id) ?? (fetched?.id === id ? fetched : null);
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [related, setRelated] = useState<Memory[]>([]);

  useEffect(() => {
    let active = true;
    void (id ? readMemory(db, id).catch(() => null) : Promise.resolve(null))
      .then(direct => { if (active && direct) setFetched(direct); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [db, id]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => (id ? listLinkedTasks(db, id) : []))
      .then(rows => { if (active) setLinkedTasks(rows); })
      .catch(() => { if (active) setLinkedTasks([]); });
    return () => { active = false; };
  }, [db, id]);
  // Surface a few semantically-near memories. The query is the first handful of words
  // from this memory; self and anything already linked-adjacent is filtered out.
  useEffect(() => {
    const seed = `${memory?.title ?? ''} ${memory?.content ?? ''}`.trim().split(/\s+/u).slice(0, 8).join(' ');
    let active = true;
    void Promise.resolve()
      .then(() => (seed.length >= 3 ? findMemories(db, seed) : []))
      .then(rows => { if (active) setRelated(rows.filter(m => m.id !== id).slice(0, 3)); })
      .catch(() => { if (active) setRelated([]); });
    return () => { active = false; };
  }, [db, id, memory?.title, memory?.content]);

  const c = bn
    ? { back: 'ফিরুন', badge: 'মেমোরির বিস্তারিত', importance: 'গুরুত্ব', tags: 'ট্যাগ', content: 'কনটেন্ট', attachments: 'সংযুক্ত ফাইল', created: 'তৈরি', updated: 'সর্বশেষ আপডেট', edit: 'সম্পাদনা', archive: 'আর্কাইভ', restore: 'রিস্টোর', share: 'শেয়ার', del: 'মুছুন', notFound: 'মেমোরি পাওয়া যায়নি', archived: 'আর্কাইভ করা হয়েছে', restored: 'ফিরিয়ে আনা হয়েছে', failed: 'কাজটি সম্পন্ন হয়নি', delTitle: 'মেমোরি মুছবেন?', delDesc: 'এই ফোন থেকে মেমোরিটি স্থায়ীভাবে মুছে যাবে।', delOk: 'মুছুন', cancel: 'বাতিল' }
    : { back: 'Back', badge: 'MEMORY DETAIL', importance: 'importance', tags: 'Tags', content: 'Content', attachments: 'Attachments', created: 'Created', updated: 'Last updated', edit: 'Edit', archive: 'Archive', restore: 'Restore', share: 'Share', del: 'Delete', notFound: 'Memory not found', archived: 'Archived', restored: 'Restored', failed: 'That action did not complete', delTitle: 'Delete memory?', delDesc: 'This permanently removes the memory from this device.', delOk: 'Delete', cancel: 'Cancel' };

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/memory'));
  const doArchive = async () => { if (!id || busy) return; setBusy(true); try { if (await archive(db, id)) { showSnackbar(c.archived, 'success'); leave(); } else showSnackbar(c.failed, 'danger'); } catch { showSnackbar(c.failed, 'danger'); } finally { setBusy(false); } };
  const doRestore = async () => { if (!id || busy) return; setBusy(true); try { const r = await restore(db, id); if (r) { setFetched(r); showSnackbar(c.restored, 'success'); leave(); } else showSnackbar(c.failed, 'danger'); } catch { showSnackbar(c.failed, 'danger'); } finally { setBusy(false); } };
  const doDelete = async () => { if (!id || busy) return; const mid = id; setBusy(true); try { if (await remove(db, mid)) { router.replace('/memory'); showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'info', { label: bn ? 'ফিরিয়ে আনুন' : 'Undo', onPress: () => void untrash(db, mid) }); } } finally { setBusy(false); setConfirmDelete(false); } };
  const doShare = () => { if (memory) void Share.share({ message: memory.title ? `${memory.title}\n\n${memory.content}` : memory.content }).catch(() => {}); };

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!memory) return (
    <View style={styles.center}>
      <View style={styles.notFoundIcon}><AppIcon name="bookmark-off-outline" size={icon.xl} color={colors.warning} /></View>
      <Text style={styles.notFoundText}>{c.notFound}</Text>
      <Pressable onPress={() => router.push("/memory" as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.secondary, pressed && styles.pressed])}><Text style={styles.secondaryText}>{c.back}</Text></Pressable>
    </View>
  );

  const tone = accents[memoryKindAccentName(memory.kind)];
  const created = ts(memory.createdAt, language);
  const updated = ts(memory.updatedAt, language);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={c.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/memory'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}><AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{c.back}</Text></Pressable>
          <Pressable onPress={() => router.push({ pathname: '/memory-editor', params: { id: memory.id } } as never)}  accessibilityRole="button" accessibilityLabel={c.edit} style={({ pressed }) => StyleSheet.flatten([styles.editBtn, pressed && styles.pressed])}><AppIcon name="pencil-outline" size={icon.sm} color={colors.primary} /></Pressable>
        </View>

        <View style={styles.headRow}>
          <View style={[styles.kindIcon, { backgroundColor: tone.soft }]}><AppIcon name={memoryKindIcon(memory.kind)} size={icon.lg} color={tone.on} /></View>
          <View style={styles.headCopy}>
            <Text style={styles.badge}>{c.badge}</Text>
            <View style={styles.kindLine}>
              <View style={[styles.kindChip, { backgroundColor: tone.soft, borderColor: tone.border }]}><Text style={[styles.kindChipText, { color: tone.on }]}>{localizeMemoryKind(memory.kind, bn)}</Text></View>
              <Text style={styles.impText}>{c.importance} {memory.importance}</Text>
              {memory.importance >= 4 ? <AppIcon name="star" size={icon.sm} color={accents.yellow.base} /> : null}
            </View>
          </View>
        </View>

        {memory.title ? <Text accessibilityRole="header" style={styles.title}>{memory.title}</Text> : null}
        <Text style={styles.contentText}>{memory.content}</Text>

        {memory.tags.length ? (
          <View style={styles.tagRow}>{memory.tags.map(t => <Pressable key={t} accessibilityRole="button" accessibilityLabel={`#${tagLabel(t, language === 'bn')}`} onPress={() => router.push({ pathname: '/memory', params: { tag: t } })} style={({ pressed }) => StyleSheet.flatten([styles.tagChip, pressed && styles.pressed])}><Text style={styles.tagText}>#{tagLabel(t, language === 'bn')}</Text></Pressable>)}</View>
        ) : null}

        {linkedTasks.length ? (
          <View style={styles.linkedWrap}>
            <Text style={styles.linkedTitle}>{bn ? 'সম্পর্কিত কাজ' : 'Linked tasks'}</Text>
            {linkedTasks.map(t => (
              <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={t.title} onPress={() => router.push({ pathname: '/task-detail', params: { id: t.id } })} style={({ pressed }) => StyleSheet.flatten([styles.linkedRow, pressed && styles.pressed])}>
                <AppIcon name="link-variant" size={icon.sm} color={colors.primary} />
                <Text numberOfLines={2} style={styles.linkedText}>{t.title}</Text>
                <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {related.length ? (
          <View style={styles.linkedWrap}>
            <Text style={styles.linkedTitle}>{bn ? 'সম্পর্কিত মেমোরি' : 'Related memories'}</Text>
            {related.map(m => (
              <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={(m.title || m.content).slice(0, 60)} onPress={() => router.push({ pathname: '/memory-detail', params: { id: m.id } })} style={({ pressed }) => StyleSheet.flatten([styles.linkedRow, pressed && styles.pressed])}>
                <AppIcon name={memoryKindIcon(m.kind)} size={icon.sm} color={colors.textMuted} />
                <Text numberOfLines={2} style={styles.linkedText}>{m.title || m.content}</Text>
                <AppIcon name="chevron-right" size={icon.sm} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {id ? <AttachmentPanel ownerType="MEMORY" ownerId={id} /> : null}

        <View style={styles.metaCard}>
          {created ? <Text style={styles.metaLine}>{c.created}: {created}</Text> : null}
          {updated ? <Text style={styles.metaLine}>{c.updated}: {updated}</Text> : null}
        </View>

        <View style={styles.actionBar}>
          
            <Pressable onPress={() => router.push({ pathname: '/memory-editor', params: { id: memory.id } } as never)}  accessibilityRole="button" style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="pencil-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.edit}</Text></Pressable>
          {memory.archived ? (
            <Pressable accessibilityRole="button" onPress={() => void doRestore()} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="backup-restore" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.restore}</Text></Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => void doArchive()} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="archive-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.archive}</Text></Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={doShare} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="share-variant-outline" size={icon.sm} color={colors.textSecondary} /><Text style={styles.barText}>{c.share}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={({ pressed }) => StyleSheet.flatten([styles.barBtn, pressed && styles.pressed])}><AppIcon name="trash-can-outline" size={icon.sm} color={colors.danger} /><Text style={[styles.barText, { color: colors.danger }]}>{c.del}</Text></Pressable>
        </View>
      </ScrollView>

      <AppConfirmDialog visible={confirmDelete} title={c.delTitle} description={c.delDesc} confirmLabel={c.delOk} cancelLabel={c.cancel} danger onCancel={() => setConfirmDelete(false)} onConfirm={() => void doDelete()} />
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
    headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
    kindIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
    headCopy: { flex: 1, minWidth: 0 },
    badge: { color: colors.textMuted, ...typography.section, letterSpacing: 0.8 },
    kindLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' },
    kindChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.smd, paddingVertical: spacing.xxs },
    kindChipText: { ...typography.caption, fontFamily: typography.label.fontFamily },
    impText: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    title: { color: colors.textPrimary, ...typography.titleLarge, marginTop: spacing.lg },
    contentText: { color: colors.textPrimary, ...typography.body, marginTop: spacing.smd },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
    tagChip: { borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
    tagText: { color: colors.textSecondary, ...typography.caption },
    linkedWrap: { marginTop: spacing.lg, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.xs },
    linkedTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700', marginBottom: spacing.xxs },
    linkedRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    linkedText: { flex: 1, minWidth: 0, color: colors.textSecondary, ...typography.bodySmall },
    metaCard: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xxs },
    metaLine: { color: colors.textMuted, ...typography.caption },
    actionBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg, borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.md },
    barBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm },
    barText: { color: colors.textSecondary, ...typography.meta, fontFamily: typography.label.fontFamily },
    secondary: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.textSecondary, ...typography.body, fontFamily: typography.label.fontFamily },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
