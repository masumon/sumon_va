import { withFabRoom } from '../src/ui/FloatingApon';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { asciiDigitsToBengali } from '../src/services/debt/money';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { ModuleGuide } from '../src/ui/ModuleGuide';
import { router, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemoryStore } from '../src/store/memory.store';
import { useAppPreferences } from '../src/app/AppPreferences';
import { AppCard, AppSkeletonList, AppState } from '../src/ui/AppSurface';
import { AppConfirmDialog, useAppFeedback } from '../src/ui/AppFeedback';
import { AppIcon } from '../src/ui/AppIcon';
import { tapSelect, warn } from '../src/ui/haptics';
import { RowLeading } from '../src/ui/RowLeading';
import { loadImageThumbs } from '../src/services/attachment-thumbs';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, memoryKindAccentName, type ThemeAccents, type ThemeColors } from '../src/theme';
import type { Memory } from '../src/types/memory-model';
import { openMemoryPreview } from '../src/ui/ItemPreviews';
import { tagLabel } from '../src/ui/TagSuggestions';

/** Bengali numerals in Bengali. ASCII digits inside a Bengali line make Android
 *  mis-measure the text and clip it, which is why this exists. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

const KIND_ICON: Record<Memory['kind'], 'note-text-outline' | 'lightbulb-on-outline' | 'heart-outline' | 'calendar-star' | 'thought-bubble-outline'> = {
  NOTE: 'note-text-outline', FACT: 'lightbulb-on-outline', PREFERENCE: 'heart-outline', EVENT: 'calendar-star', REFLECTION: 'thought-bubble-outline',
};

const KIND_LABELS = {
  NOTE: { en: 'Note', bn: 'নোট' },
  FACT: { en: 'Fact', bn: 'তথ্য' },
  PREFERENCE: { en: 'Preference', bn: 'পছন্দ' },
  EVENT: { en: 'Event', bn: 'ঘটনা' },
  REFLECTION: { en: 'Reflection', bn: 'ভাবনা' },
} as const;

export default function MemoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const params = useLocalSearchParams<{ tag?: string }>();
  const [kindFilter, setKindFilter] = useState<Memory['kind'] | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(params.tag ?? null);
  // Tags stay out of the way until asked for (the user's request): a "# ট্যাগ" chip opens
  // the row; it stays open while a tag is picked, so the filter in use is always visible.
  const [tagsOpen, setTagsOpen] = useState(false);
  const [sort, setSort] = useState<'recent' | 'oldest' | 'importance'>('recent');
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const { memories, isLoading, error, load, loadArchived, search, archive, restore, remove, untrash } = useMemoryStore();
  const { showSnackbar } = useAppFeedback();
  const searching = Boolean(query.trim()) && !showArchived;
  const availableKinds = useMemo(() => {
    const set = new Set<Memory['kind']>();
    for (const m of memories) set.add(m.kind);
    return (Object.keys(KIND_LABELS) as Memory['kind'][]).filter(k => set.has(k));
  }, [memories]);
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) for (const tag of m.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([tag]) => tag);
    // A chosen tag always has its chip, so it can be seen and cleared (e.g. opened from a
    // memory's tag, or its last memory archived) — rc.20 audit.
    return tagFilter && !top.includes(tagFilter) ? [...top, tagFilter] : top;
  }, [memories, tagFilter]);
  const visible = useMemo(() => {
    const rows = memories.filter(m => (!kindFilter || m.kind === kindFilter) && (!tagFilter || m.tags.includes(tagFilter)));
    if (sort === 'recent') return rows;
    const copy = [...rows];
    if (sort === 'oldest') copy.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    else copy.sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt));
    return copy;
  }, [memories, kindFilter, tagFilter, sort]);
  const listData = useMemo<({ header: string } | Memory)[]>(() => {
    if (showArchived || query.trim() || kindFilter || tagFilter || sort !== 'recent') return visible;
    const important = visible.filter(m => m.importance >= 4);
    const rest = visible.filter(m => m.importance < 4);
    if (!important.length || !rest.length) return visible;
    return [{ header: bn ? 'গুরুত্বপূর্ণ' : 'Important' }, ...important, { header: bn ? 'সাম্প্রতিক' : 'Recent' }, ...rest];
  }, [visible, showArchived, query, kindFilter, tagFilter, sort, bn]);

  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const visibleIdKey = visible.map(m => m.id).join(',');
  useEffect(() => {
    let alive = true;
    loadImageThumbs(db, 'MEMORY', visibleIdKey ? visibleIdKey.split(',') : [])
      .then(map => { if (alive) setThumbs(map); })
      .catch(() => { if (alive) setThumbs(new Map()); });
    return () => { alive = false; };
  }, [db, visibleIdKey]);

  useEffect(() => { void (showArchived ? loadArchived(db) : load(db)); }, [db, load, loadArchived, showArchived]);
  useEffect(() => {
    if (showArchived) return;
    const value = query.trim();
    if (!value) { void load(db); return; }
    const timer = setTimeout(() => void search(db, value), 180);
    return () => clearTimeout(timer);
  }, [db, query, load, search, showArchived]);

  const copy = useMemo(() => (bn
    ? { active: 'সক্রিয়', archived: 'আর্কাইভ', title: 'আপনার মেমোরি', archiveTitle: 'আর্কাইভ করা মেমোরি', subtitle: 'ব্যক্তিগত নোট ও গুরুত্বপূর্ণ তথ্য এই ফোনেই থাকে।', search: 'মেমোরি খুঁজুন', add: 'যোগ', empty: 'এখনও কোনো মেমোরি নেই', emptyText: 'পরে মনে রাখার মতো গুরুত্বপূর্ণ কিছু লিখে রাখুন।', noMatch: 'কোনো মিল পাওয়া যায়নি', restoreText: 'আর্কাইভ করা মেমোরি প্রয়োজন হলে ফিরিয়ে আনুন।', first: 'প্রথম মেমোরি তৈরি করুন', edit: 'এডিট', restore: 'রিস্টোর', archive: 'আর্কাইভ', delete: 'মুছুন', importance: 'গুরুত্ব', retry: 'আবার চেষ্টা করুন', clear: 'সার্চ মুছুন', deleteTitle: 'মেমোরি মুছবেন?', deleteDescription: 'এই ফোন থেকে মেমোরিটি স্থায়ীভাবে মুছে যাবে।', deleteConfirm: 'মুছুন', cancel: 'বাতিল', select: 'নির্বাচন', selected: 'নির্বাচিত', done: 'সম্পন্ন', bulkDeleteTitle: 'নির্বাচিতগুলো মুছবেন?', bulkDeleteDesc: 'এগুলো “মুছে ফেলা জিনিস”-এ যাবে — ৩০ দিন পর্যন্ত ফেরানো যাবে।' }
    : { active: 'Active', archived: 'Archived', title: 'Your memory', archiveTitle: 'Archived memories', subtitle: 'Private notes and facts stay on this device.', search: 'Search memories', add: 'Add', empty: 'No memories yet', emptyText: 'Capture something important to remember later.', noMatch: 'No matching memories', restoreText: 'Restore archived memories whenever you need them.', first: 'Create your first memory', edit: 'Edit', restore: 'Restore', archive: 'Archive', delete: 'Delete', importance: 'importance', retry: 'Retry', clear: 'Clear search', deleteTitle: 'Delete memory?', deleteDescription: 'This permanently removes the memory from this device.', deleteConfirm: 'Delete', cancel: 'Cancel', select: 'Select', selected: 'selected', done: 'Done', bulkDeleteTitle: 'Delete the selected memories?', bulkDeleteDesc: 'They go to Deleted items — recoverable for 30 days.' }), [bn]);

  const onArchiveRow = useCallback((id: string) => void archive(db, id), [archive, db]);
  const onRestoreRow = useCallback((id: string) => void restore(db, id), [restore, db]);
  const onDeleteRow = useCallback((m: Memory) => setPendingDelete(m), []);

  const toggleOne = useCallback((id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const exitSelect = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const enterSelect = useCallback((id: string) => { setSelectMode(true); setSelected(new Set([id])); }, []);
  const bulkArchive = useCallback(async () => {
    const ids = [...selected]; exitSelect();
    for (const id of ids) { try { await archive(db, id); } catch { /* skip one */ } }
    if (ids.length) showSnackbar(bn ? `${bnNum(ids.length)}টি আর্কাইভ হয়েছে` : `${bnNum(ids.length)} archived`, 'success');
  }, [selected, exitSelect, archive, db, bn, showSnackbar]);
  const bulkDelete = useCallback(async () => {
    const ids = [...selected]; exitSelect();
    let n = 0;
    for (const id of ids) { try { if (await remove(db, id)) n += 1; } catch { /* skip one */ } }
    if (n) showSnackbar(bn ? `${asciiDigitsToBengali(String(n))}টি মুছে ফেলা হয়েছে` : `${n} deleted`, 'info', { label: bn ? 'ফিরিয়ে আনুন' : 'Undo', onPress: () => { for (const id of ids) void untrash(db, id); } });
  }, [selected, exitSelect, remove, db, bn, showSnackbar, untrash]);

  const renderRow = useCallback(({ item }: { item: { header: string } | Memory }) => {
    if ('header' in item) return <Text style={styles.groupHeader}>{item.header}</Text>;
    if (selectMode) return <SelectableRow memory={item} checked={selected.has(item.id)} onToggle={toggleOne} styles={styles} colors={colors} accents={accents} bn={bn} />;
    return <MemoryRow memory={item} archived={showArchived} onArchive={onArchiveRow} onRestore={onRestoreRow} onDelete={onDeleteRow} onLongPress={enterSelect} styles={styles} colors={colors} accents={accents} copy={copy} bn={bn} thumbUri={thumbs.get(item.id)} />;
  }, [selectMode, selected, toggleOne, enterSelect, showArchived, onArchiveRow, onRestoreRow, onDeleteRow, styles, colors, accents, copy, bn, thumbs]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><AppIcon name="bookmark-multiple-outline" size={icon.lg} color={colors.primary} /></View>
          <View style={styles.titleCopy}>
            <Text style={styles.eyebrow}>{bn ? 'মেমোরি' : 'MEMORY'}</Text>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{showArchived ? copy.archiveTitle : copy.title}</Text>
          </View>
          {!showArchived ? <View style={{ marginRight: 8 }}><ModuleGuide id="memory" /></View> : null}
          {!showArchived ? (
            <Pressable accessibilityRole="button" accessibilityLabel={copy.add} onPress={() => router.push('/memory-editor')} style={({ pressed }) => StyleSheet.flatten([styles.addButton, pressed && styles.pressed])}>
              <AppIcon name="plus" size={icon.sm} color={colors.onPrimary} />
              <Text style={styles.addButtonText}>{copy.add}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>

      {!showArchived ? (
        <View style={styles.searchBox}>
          <AppIcon name="magnify" size={icon.md} color={colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={copy.search} placeholderTextColor={colors.textMuted} accessibilityLabel={copy.search} returnKeyType="search" style={styles.search} />
          {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={copy.clear} hitSlop={8}><AppIcon name="close-circle" size={icon.md} color={colors.textMuted} /></Pressable> : null}
          {availableTags.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: tagsOpen || !!tagFilter }}
              accessibilityLabel={bn ? 'ট্যাগ দেখান' : 'Show tags'}
              onPress={() => { tapSelect(); if (tagsOpen || tagFilter) { setTagsOpen(false); setTagFilter(null); } else setTagsOpen(true); }}
              hitSlop={8}
              style={({ pressed }) => StyleSheet.flatten([styles.sortBtn, (tagsOpen || !!tagFilter) && styles.sortBtnOn, pressed && styles.pressed])}
            >
              <AppIcon name="tag-outline" size={icon.md} color={tagsOpen || tagFilter ? colors.primary : colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={(bn ? { recent: 'সাজানো: নতুন আগে', oldest: 'সাজানো: পুরনো আগে', importance: 'সাজানো: গুরুত্ব' } : { recent: 'Sort: newest first', oldest: 'Sort: oldest first', importance: 'Sort: importance' })[sort]}
            onPress={() => { tapSelect(); setSort(s => (s === 'recent' ? 'oldest' : s === 'oldest' ? 'importance' : 'recent')); }}
            hitSlop={8}
            style={({ pressed }) => StyleSheet.flatten([styles.sortBtn, sort !== 'recent' && styles.sortBtnOn, pressed && styles.pressed])}
          >
            <AppIcon name={sort === 'oldest' ? 'sort-clock-ascending-outline' : sort === 'importance' ? 'sort-variant' : 'sort-clock-descending-outline'} size={icon.md} color={sort !== 'recent' ? colors.primary : colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {!showArchived && availableKinds.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !kindFilter }} onPress={() => setKindFilter(null)} style={[styles.filterChip, !kindFilter && styles.filterChipOn]}>
            <Text style={[styles.filterChipText, !kindFilter && styles.filterChipTextOn]}>{bn ? 'সব' : 'All'}</Text>
          </Pressable>
          {availableKinds.map(k => (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: kindFilter === k }} onPress={() => { tapSelect(); setKindFilter(kindFilter === k ? null : k); }} style={[styles.filterChip, kindFilter === k && styles.filterChipOn]}>
              <Text style={[styles.filterChipText, kindFilter === k && styles.filterChipTextOn]}>{bn ? KIND_LABELS[k].bn : KIND_LABELS[k].en}</Text>
            </Pressable>
          ))}
          
        </View>
      ) : null}
      {/* One row that slides sideways (rc.7): thirteen tags in three wrapped rows pushed the
          memories themselves off the first screen. */}
      {!showArchived && availableTags.length && (tagsOpen || tagFilter) ? (
        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagFilterRow}>
          {availableTags.map(tag => (
            <Pressable key={tag} accessibilityRole="button" accessibilityState={{ selected: tagFilter === tag }} onPress={() => { tapSelect(); setTagFilter(tagFilter === tag ? null : tag); }} style={[styles.filterChip, tagFilter === tag && styles.filterChipOn]}>
              <Text style={[styles.filterChipText, tagFilter === tag && styles.filterChipTextOn]}>#{tagLabel(tag, bn)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.viewToggle}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: !showArchived }} onPress={() => { exitSelect(); setQuery(''); setKindFilter(null); setTagFilter(null); setShowArchived(false); }} style={[styles.toggleButton, !showArchived && styles.toggleSelected]}>
          <AppIcon name="bookmark-outline" size={icon.sm} color={!showArchived ? colors.onPrimary : colors.textSecondary} />
          <Text style={[styles.toggleText, !showArchived && styles.toggleSelectedText]}>{copy.active}</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: showArchived }} onPress={() => { exitSelect(); setQuery(''); setKindFilter(null); setTagFilter(null); setShowArchived(true); }} style={[styles.toggleButton, showArchived && styles.toggleSelected]}>
          <AppIcon name="archive-outline" size={icon.sm} color={showArchived ? colors.onPrimary : colors.textSecondary} />
          <Text style={[styles.toggleText, showArchived && styles.toggleSelectedText]}>{copy.archived}</Text>
        </Pressable>
      </View>

      {visible.length ? (selectMode ? (
        <View style={styles.selectBar}>
          <Pressable onPress={exitSelect} accessibilityRole="button" accessibilityLabel={copy.cancel} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, pressed && styles.pressed])}>
            <AppIcon name="close" size={icon.sm} color={colors.textSecondary} /><Text style={styles.selectBarText}>{copy.done}</Text>
          </Pressable>
          <Text style={styles.selectCount}>{selected.size} {copy.selected}</Text>
          <View style={styles.selectBarActions}>
            {!showArchived ? (
              <Pressable disabled={!selected.size} onPress={() => void bulkArchive()} accessibilityRole="button" accessibilityLabel={copy.archive} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, !selected.size && styles.disabledRow, pressed && styles.pressed])}>
                <AppIcon name="archive-outline" size={icon.sm} color={colors.primary} /><Text style={styles.selectBarText}>{copy.archive}</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={!selected.size} onPress={() => setConfirmBulk(true)} accessibilityRole="button" accessibilityLabel={copy.delete} style={({ pressed }) => StyleSheet.flatten([styles.selectBarBtn, !selected.size && styles.disabledRow, pressed && styles.pressed])}>
              <AppIcon name="delete-outline" size={icon.sm} color={colors.danger} /><Text style={[styles.selectBarText, { color: colors.danger }]}>{copy.delete}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setSelectMode(true)} accessibilityRole="button" accessibilityLabel={copy.select} style={({ pressed }) => StyleSheet.flatten([styles.selectToggle, pressed && styles.pressed])}>
          <AppIcon name="checkbox-multiple-marked-outline" size={icon.sm} color={colors.primary} /><Text style={styles.selectToggleText}>{copy.select}</Text>
        </Pressable>
      )) : null}

      {error ? <AppState title={bn ? 'মেমোরি লোড করা যায়নি' : 'Could not load memories'} description={bn ? 'তথ্য আনতে আবার চেষ্টা করুন।' : 'Unable to load local memory data.'} icon="alert-circle-outline" actionLabel={copy.retry} onAction={() => void (showArchived ? loadArchived(db) : load(db))} /> : null}

      {isLoading && !searching ? (
        <AppSkeletonList rows={5} />
      ) : (
        <FlatList keyboardDismissMode="on-drag"
          data={selectMode ? visible : listData}
          extraData={selectMode ? selected : null}
          keyExtractor={item => 'header' in item ? `h:${item.header}` : item.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={withFabRoom(listData.length ? styles.list : styles.emptyList)}
          ListEmptyComponent={error ? null : <AppState icon={showArchived ? 'archive-off-outline' : 'bookmark-outline'} title={showArchived ? copy.archived : (query || kindFilter || tagFilter) ? copy.noMatch : copy.empty} description={showArchived ? copy.restoreText : (query || kindFilter || tagFilter) ? copy.noMatch : copy.emptyText} actionLabel={!showArchived && !(query || kindFilter || tagFilter) ? copy.first : undefined} onAction={!showArchived && !(query || kindFilter || tagFilter) ? () => router.push('/memory-editor') : undefined} />}
          renderItem={renderRow}
        />
      )}

      <AppConfirmDialog
        visible={Boolean(pendingDelete)}
        title={copy.deleteTitle}
        description={pendingDelete?.content.slice(0, 120) ?? copy.deleteDescription}
        confirmLabel={copy.deleteConfirm}
        cancelLabel={copy.cancel}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { warn(); const target = pendingDelete; setPendingDelete(null); if (target) void remove(db, target.id).then((ok) => { if (ok) showSnackbar(bn ? 'মুছে ফেলা হয়েছে' : 'Deleted', 'info', { label: bn ? 'ফিরিয়ে আনুন' : 'Undo', onPress: () => void untrash(db, target.id) }); }); }}
      />

      <AppConfirmDialog
        visible={confirmBulk}
        title={copy.bulkDeleteTitle}
        description={copy.bulkDeleteDesc}
        confirmLabel={copy.deleteConfirm}
        cancelLabel={copy.cancel}
        danger
        onCancel={() => setConfirmBulk(false)}
        onConfirm={() => { warn(); setConfirmBulk(false); void bulkDelete(); }}
      />
    </View>
  );
}

const SelectableRow = memo(function SelectableRow({ memory, checked, onToggle, styles, colors, accents, bn }: { memory: Memory; checked: boolean; onToggle: (id: string) => void; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; bn: boolean }) {
  const kind = KIND_LABELS[memory.kind] ?? KIND_LABELS.NOTE;
  const tone = accents[memoryKindAccentName(memory.kind)];
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={(memory.title || memory.content).slice(0, 60)}
      onPress={() => onToggle(memory.id)}
      style={({ pressed }) => StyleSheet.flatten([styles.selRow, checked && styles.selRowOn, pressed && styles.pressed])}
    >
      <AppIcon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={icon.md} color={checked ? colors.primary : colors.textMuted} />
      <View style={styles.selRowCopy}>
        {memory.title ? <Text numberOfLines={1} style={styles.selRowTitle}>{memory.title}</Text> : null}
        <Text numberOfLines={2} style={styles.selRowText}>{memory.content}</Text>
      </View>
      <View style={[styles.kindBadge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
        <Text style={[styles.kindText, { color: tone.on }]}>{bn ? kind.bn : kind.en}</Text>
      </View>
    </Pressable>
  );
});

function ImportanceDots({ value, color, styles }: { value: number; color: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4, 5].map(n => <View key={n} style={[styles.dot, { backgroundColor: n <= value ? color : 'transparent', borderColor: color }]} />)}
    </View>
  );
}

const MemoryRow = memo(function MemoryRow({ memory, archived, onArchive, onRestore, onDelete, onLongPress, styles, colors, accents, copy, bn, thumbUri }: { memory: Memory; archived: boolean; onArchive: (id: string) => void; onRestore: (id: string) => void; onDelete: (memory: Memory) => void; onLongPress?: (id: string) => void; styles: ReturnType<typeof makeStyles>; colors: ThemeColors; accents: ThemeAccents; copy: Record<string, string>; bn: boolean; thumbUri?: string }) {
  const kind = KIND_LABELS[memory.kind] ?? KIND_LABELS.NOTE;
  const tone = accents[memoryKindAccentName(memory.kind)];
  return (
    <AppCard style={styles.memoryRow}>
      <View style={styles.memoryTop}>
        <View style={styles.memoryTopLeft}>
          <RowLeading thumbUri={thumbUri} icon={KIND_ICON[memory.kind]} tone={memoryKindAccentName(memory.kind)} size={36} />
          <View style={[styles.kindBadge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
            <Text style={[styles.kindText, { color: tone.on }]}>{bn ? kind.bn : kind.en}</Text>
          </View>
        </View>
        <ImportanceDots value={memory.importance} color={tone.base} styles={styles} />
      </View>
      
        <Pressable onPress={() => openMemoryPreview(memory)}  accessibilityRole="button" accessibilityHint={bn ? 'একটানা চেপে ধরলে নির্বাচন মোড' : 'Long-press to select multiple'} accessibilityLabel={`${bn ? 'মেমোরি খুলুন' : 'Open memory'}: ${memory.content.slice(0, 60)}`} onLongPress={onLongPress ? () => onLongPress(memory.id) : undefined} delayLongPress={350} style={({ pressed }) => StyleSheet.flatten([styles.memoryBody, pressed && styles.pressed])}>
          {memory.title ? <Text style={styles.memoryTitle}>{memory.title}</Text> : null}
          <Text style={styles.memoryContent} numberOfLines={4}>{memory.content}</Text>
        </Pressable>
      {/* A memory's tags show in its preview (tap the card), not on the list card — the list
          reads cleaner (the user's request). The "# ট্যাগ" chip above still filters by them. */}
      <View style={styles.rowActions}>
        
          <Pressable onPress={() => router.push({ pathname: '/memory-editor', params: { id: memory.id } } as never)}  accessibilityRole="button" accessibilityLabel={copy.edit} style={({ pressed }) => StyleSheet.flatten([styles.actionButton, pressed && styles.pressed])}>
            <AppIcon name="pencil-outline" size={icon.sm} color={colors.primary} /><Text style={styles.actionText}>{copy.edit}</Text>
          </Pressable>
        {archived ? (
          <Pressable accessibilityRole="button" accessibilityLabel={copy.restore} onPress={() => onRestore(memory.id)} style={({ pressed }) => StyleSheet.flatten([styles.actionButton, pressed && styles.pressed])}>
            <AppIcon name="backup-restore" size={icon.sm} color={colors.primary} /><Text style={styles.actionText}>{copy.restore}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={copy.archive} onPress={() => onArchive(memory.id)} style={({ pressed }) => StyleSheet.flatten([styles.actionButton, pressed && styles.pressed])}>
            <AppIcon name="archive-outline" size={icon.sm} color={colors.primary} /><Text style={styles.actionText}>{copy.archive}</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={copy.delete} onPress={() => onDelete(memory)} style={({ pressed }) => StyleSheet.flatten([styles.actionButton, pressed && styles.pressed])}>
          <AppIcon name="delete-outline" size={icon.sm} color={colors.danger} /><Text style={styles.deleteText}>{copy.delete}</Text>
        </Pressable>
      </View>
    </AppCard>
  );
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.md },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    titleIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
    titleCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xxs },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.md },
    addButton: { minHeight: layout.minTouchTarget, minWidth: 78, maxWidth: 120, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, borderWidth: border.thin, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, ...elevation.soft },
    addButtonText: { color: colors.onPrimary, ...typography.bodySmall, fontWeight: '700' },
    searchBox: { minHeight: control.searchHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.soft },
    search: { flex: 1, minHeight: control.inputHeight, color: colors.textPrimary, ...typography.body },
    sortBtn: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    sortBtnOn: { backgroundColor: colors.primaryTint },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginHorizontal: spacing.lg, marginBottom: spacing.md },
    tagScroll: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.md },
    tagFilterRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg },
    filterChip: { minHeight: layout.minTouchTarget - spacing.smd, justifyContent: 'center', paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    filterChipOn: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
    filterChipText: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    filterChipTextOn: { color: colors.primary },
    viewToggle: { flexDirection: 'row', marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.xxs, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
    toggleButton: { flex: 1, minHeight: layout.minTouchTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs },
    toggleSelected: { backgroundColor: colors.primary },
    toggleText: { color: colors.textSecondary, ...typography.meta, fontWeight: '800', flexShrink: 1 },
    toggleSelectedText: { color: colors.onPrimary },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    groupHeader: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, letterSpacing: 0.6, marginTop: spacing.sm, marginBottom: spacing.xxs },
    emptyList: { flexGrow: 1, paddingHorizontal: spacing.lg },
    memoryRow: { padding: spacing.md, gap: spacing.sm },
    memoryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    memoryTopLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
    kindBadge: { borderWidth: border.thin, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
    kindText: { ...typography.caption, fontWeight: '700' },
    dots: { flexDirection: 'row', gap: spacing.xxs },
    dot: { width: 7, height: 7, borderRadius: radius.pill, borderWidth: border.thin },
    memoryBody: { gap: spacing.xs },
    memoryTitle: { color: colors.textPrimary, ...typography.body, fontWeight: '800' },
    memoryContent: { color: colors.textPrimary, ...typography.bodySmall, lineHeight: 22 },
    rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xxs, borderTopWidth: border.thin, borderTopColor: colors.border, paddingTop: spacing.sm },
    actionButton: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
    actionText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    deleteText: { color: colors.danger, ...typography.meta, fontWeight: '800' },
    selectToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: spacing.xxs, minHeight: layout.minTouchTarget, marginHorizontal: spacing.lg, paddingHorizontal: spacing.xs },
    selectToggleText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    selectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    selectBarActions: { flexDirection: 'row', gap: spacing.xs },
    selectBarBtn: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
    selectBarText: { color: colors.primary, ...typography.meta, fontWeight: '800' },
    selectCount: { flex: 1, textAlign: 'center', color: colors.textSecondary, ...typography.meta, fontWeight: '800', fontFamily: typography.numeric.fontFamily },
    disabledRow: { opacity: opacity.disabled },
    selRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.minTouchTarget, padding: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    selRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
    selRowCopy: { flex: 1, minWidth: 0 },
    selRowTitle: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800' },
    selRowText: { color: colors.textSecondary, ...typography.caption },
    pressed: { opacity: opacity.pressed },
  });
}
