import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Reading the question itself, not only matching its words — see `life-query-service`.
import { askAboutMoney, type QueryMatch } from '../src/services/life-query-service';
import { eventLook, eventTypeLabel, eventWord } from '../src/services/life-event-copy';
import { formatBangladeshDate } from '../src/i18n/date-time';
import { asciiDigitsToBengali, formatPaisa } from '../src/services/debt/money';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../src/ui/AppText';
import { useRouter } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { searchAll, type UnifiedSearchResult } from '../src/services/unified-search-service';
import { useAppPreferences } from '../src/app/AppPreferences';
import { search } from '../src/i18n/search';
import { AppIcon } from '../src/ui/AppIcon';
import { AppState } from '../src/ui/AppSurface';
import { border, control, elevation, icon, layout, opacity, radius, spacing, typography, memoryKindAccentName, memoryKindIcon, priorityAccentName, type ThemeAccents, type ThemeColors } from '../src/theme';
import { localizeMemoryKind, localizeTaskPriority, localizeTaskStatus } from '../src/i18n/domain-labels';

const EMPTY_RESULT: UnifiedSearchResult = { tasks: [], memories: [], modules: [] };
const RECENTS_KEY = 'searchHistory';
let recentSearches: string[] = [];
let recentsHydrated = false;
async function hydrateRecents(db: SQLiteDatabase) {
  if (recentsHydrated) return;
  recentsHydrated = true;
  try {
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = ?", RECENTS_KEY);
    const parsed = row?.value ? JSON.parse(row.value) : [];
    if (Array.isArray(parsed)) recentSearches = parsed.filter((v): v is string => typeof v === 'string').slice(0, 6);
  } catch { /* history is a nicety, not critical */ }
}
function rememberSearch(db: SQLiteDatabase, value: string) {
  const v = value.trim();
  if (v.length < 2) return;
  const i = recentSearches.indexOf(v);
  if (i >= 0) recentSearches.splice(i, 1);
  recentSearches.unshift(v);
  if (recentSearches.length > 6) recentSearches.length = 6;
  void db.runAsync(
    "INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    RECENTS_KEY, JSON.stringify(recentSearches),
  ).catch(() => {});
}
/** 'ALL', 'TASKS', 'MEMORIES', or a module id — whichever modules found something. */
type SearchFilter = string;

// A plain array literal mixing these three row shapes infers to just the last one seen
// (a TS quirk with SectionList's generics, not something a wider array type alone fixes),
// so the section list is typed explicitly instead of left to inference.
type ResultItem =
  | { type: 'task'; id: string; task: UnifiedSearchResult['tasks'][number] }
  | { type: 'memory'; id: string; memory: UnifiedSearchResult['memories'][number] }
  | { type: 'module'; id: string; hit: UnifiedSearchResult['modules'][number]['hits'][number]; module: UnifiedSearchResult['modules'][number]['module'] };
type ResultSection = { key: string; title: string; data: ResultItem[] };

export default function SearchScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [, forceRender] = useState(0);
  useEffect(() => { void hydrateRecents(db).then(() => forceRender(n => n + 1)); }, [db]);
  const { colors, accents, language } = useAppPreferences();
  const copy = search(language);
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<UnifiedSearchResult>(EMPTY_RESULT);
  const [filter, setFilter] = useState<SearchFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer to the question, when the words turned out to be one. Separate from
  // `result` because it is a different kind of thing: not a list of matches for a string,
  // but what the app makes of a sentence.
  const [answer, setAnswer] = useState<{ text: string; matches: QueryMatch[] } | null>(null);
  const requestId = useRef(0);

  const runSearch = useCallback((value: string, request: number) => {
    setLoading(true);
    setError(null);
    void searchAll(db, value, language)
      .then((next) => { if (request === requestId.current) { setResult(next); if (next.tasks.length || next.memories.length || next.modules.length) rememberSearch(db, value); } })
      .catch(() => { if (request === requestId.current) setError(copy.failedDescription); })
      .finally(() => { if (request === requestId.current) setLoading(false); });

    // Asked in parallel and allowed to fail quietly: a question the parser cannot read is
    // the ordinary case, and the plain search underneath is already answering it.
    void askAboutMoney(db, value, language)
      .then((found) => {
        if (request !== requestId.current) return;
        setAnswer(found && found.matches.length ? { text: found.answer, matches: found.matches } : null);
      })
      .catch(() => { if (request === requestId.current) setAnswer(null); });
  }, [copy.failedDescription, db, language]);

  useEffect(() => {
    const value = query.trim();
    const currentRequest = ++requestId.current;
    const timer = setTimeout(() => {
      if (!value) { setResult(EMPTY_RESULT); setError(null); setAnswer(null); setLoading(false); return; }
      runSearch(value, currentRequest);
    }, value ? 180 : 0);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const retry = () => { const value = query.trim(); if (value) runSearch(value, ++requestId.current); };
  const visibleTasks = filter === 'ALL' || filter === 'TASKS' ? result.tasks : [];
  const visibleMemories = filter === 'ALL' || filter === 'MEMORIES' ? result.memories : [];
  const visibleModules = filter === 'ALL' ? result.modules : result.modules.filter((m) => m.module.id === filter);
  const totalCount = visibleTasks.length + visibleMemories.length + visibleModules.reduce((n, m) => n + m.hits.length, 0);

  // Neither task search nor a module's own search caps how many rows come back, and
  // `searchMemories` (memory-repository.ts) has no LIMIT at all -- a common word can
  // genuinely return hundreds of memories. `SectionList` only mounts what is on screen;
  // the plain `.map()` this replaced mounted every row in every group at once, so a broad
  // query paid for hundreds of off-screen rows on every keystroke's re-render.
  const sections: ResultSection[] = [
    ...(visibleTasks.length ? [{
      key: 'tasks',
      title: `${copy.tasks} · ${visibleTasks.length}`,
      data: visibleTasks.map((task) => ({ type: 'task' as const, id: `task-${task.id}`, task })),
    }] : []),
    ...(visibleMemories.length ? [{
      key: 'memories',
      title: `${copy.memories} · ${visibleMemories.length}`,
      data: visibleMemories.map((memory) => ({ type: 'memory' as const, id: `memory-${memory.id}`, memory })),
    }] : []),
    ...visibleModules.map(({ module, hits }) => ({
      key: module.id,
      title: `${module.title(language)} · ${language === 'bn' ? asciiDigitsToBengali(String(hits.length)) : hits.length}`,
      data: hits.map((hit) => ({ type: 'module' as const, id: `module-${module.id}-${hit.id}`, hit, module })),
    })),
  ];

  const header = (
    <>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={({ pressed }) => StyleSheet.flatten([styles.back, pressed && styles.pressed])}><AppIcon name="arrow-left" size={icon.md} color={colors.primary} /><Text style={styles.backText}>{copy.back}</Text></Pressable>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}><AppIcon name="magnify" size={icon.lg} color={accents.blue.on} /></View>
          <View style={styles.titleCopy}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text accessibilityRole="header" style={styles.title}>{copy.title}</Text></View>
        </View>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>

      <View style={styles.searchBox}>
        <AppIcon name="magnify" size={icon.md} color={colors.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={copy.placeholder} placeholderTextColor={colors.textMuted} autoFocus style={styles.input} accessibilityLabel={copy.placeholder} returnKeyType="search" />
        {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={copy.clear} style={styles.clearButton}><AppIcon name="close-circle" size={icon.md} color={colors.textMuted} /></Pressable> : null}
      </View>

      {/* The answer, when the words were a question rather than a term.
          Above the ordinary results and visibly a different thing: a sentence first, then
          the records it rests on, so nothing is asserted that cannot be checked. */}
      {answer ? (
        <View style={styles.answerCard}>
          <View style={styles.answerHead}>
            <AppIcon name="lightbulb-on-outline" size={icon.md} color={accents.yellow.on} />
            <Text style={styles.answerText}>{answer.text}</Text>
          </View>
          {answer.matches.slice(0, 6).map((m) => {
            const look = eventLook(m.type);
            const tone = accents[look.tone];
            const detail = [m.personName, m.place, eventWord(m.purpose, language), eventWord(m.destination, language)]
              .filter(Boolean).join(' · ');
            return (
              <View key={m.id} style={styles.answerRow}>
                <View style={[styles.answerBadge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
                  <AppIcon name={look.icon} size={icon.sm} color={tone.on} />
                </View>
                <View style={styles.answerBody}>
                  <Text numberOfLines={1} style={styles.answerTitle}>
                    {m.title?.trim() || eventTypeLabel(m.type, language)}
                  </Text>
                  <Text numberOfLines={1} style={styles.answerMeta}>
                    {[formatBangladeshDate(m.occurredAt, language), eventTypeLabel(m.type, language), detail]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {m.amountPaisa ? (
                  <Text style={styles.answerAmount}>
                    {formatPaisa(m.amountPaisa, { symbol: true, bnDigits: language === 'bn' })}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.filterRow} accessibilityRole="radiogroup">
        {[
          ['ALL', copy.all] as const,
          ['TASKS', copy.tasks] as const,
          ['MEMORIES', copy.memories] as const,
          // One chip per module that actually returned something for this query.
          ...result.modules.map((m) => [m.module.id, m.module.title(language)] as const),
        ].map(([value, label]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: filter === value }} accessibilityLabel={label} onPress={() => setFilter(value)} style={({ pressed }) => StyleSheet.flatten([styles.filterChip, filter === value && styles.filterSelected, pressed && styles.pressed])}>
            <Text style={[styles.filterText, filter === value && styles.filterSelectedText]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>{copy.searching}</Text></View> : null}
      {error ? <AppState title={copy.failedTitle} description={error} icon="alert-circle-outline" actionLabel={copy.retry} onAction={retry} /> : null}
      {!query.trim() && !loading && recentSearches.length ? (
        <View style={styles.recentWrap}>
          <Text style={styles.recentLabel}>{language === 'bn' ? 'সাম্প্রতিক সার্চ' : 'Recent searches'}</Text>
          <View style={styles.recentRow}>
            {recentSearches.map((r) => (
              <Pressable key={r} accessibilityRole="button" accessibilityLabel={r} onPress={() => setQuery(r)} style={({ pressed }) => StyleSheet.flatten([styles.recentChip, pressed && styles.pressed])}>
                <AppIcon name="history" size={icon.xs} color={colors.textMuted} />
                <Text numberOfLines={1} style={styles.recentChipText}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {!query.trim() && !loading && !recentSearches.length ? <AppState icon="text-search" title={copy.title} description={copy.startHint} /> : null}
      {query.trim() && !loading && !totalCount && !error ? <AppState icon="database-search-outline" title={copy.empty} description={copy.emptyHint} /> : null}
    </>
  );

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
      renderItem={({ item }) => {
        if (item.type === 'task') {
          const { task } = item;
          const tone = accents[priorityAccentName(task.priority)];
          return (
            <Pressable onPress={() => router.push({ pathname: '/task-detail', params: { id: task.id } } as never)} accessibilityRole="button" accessibilityLabel={`${copy.openTask} ${task.title}`} style={({ pressed }) => StyleSheet.flatten([styles.resultCard, pressed && styles.pressed])}>
              <View style={[styles.resultIcon, { backgroundColor: tone.soft }]}><AppIcon name="clipboard-text-outline" size={icon.sm} color={tone.on} /></View>
              <View style={styles.resultCopy}>
                <Text numberOfLines={3} style={styles.resultTitle}>{task.title}</Text>
                <Text style={styles.meta}>{localizeTaskStatus(task.status, language === 'bn')} · {localizeTaskPriority(task.priority, language === 'bn')}</Text>
              </View>
              <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
            </Pressable>
          );
        }
        if (item.type === 'memory') {
          const { memory } = item;
          const tone = accents[memoryKindAccentName(memory.kind)];
          return (
            <Pressable onPress={() => router.push({ pathname: '/memory-detail', params: { id: memory.id } } as never)} accessibilityRole="button" accessibilityLabel={`${copy.openMemory} ${memory.content.slice(0, 60)}`} style={({ pressed }) => StyleSheet.flatten([styles.resultCard, pressed && styles.pressed])}>
              <View style={[styles.resultIcon, { backgroundColor: tone.soft }]}><AppIcon name={memoryKindIcon(memory.kind)} size={icon.sm} color={tone.on} /></View>
              <View style={styles.resultCopy}>
                <Text numberOfLines={3} style={styles.resultTitle}>{memory.content}</Text>
                <Text style={styles.meta}>{localizeMemoryKind(memory.kind, language === 'bn')} · {copy.importance} {memory.importance}</Text>
              </View>
              <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
            </Pressable>
          );
        }
        const { hit, module } = item;
        const tone = accents[hit.tone ?? module.tone];
        return (
          <Pressable onPress={() => router.push(hit.route as never)} accessibilityRole="button" accessibilityLabel={hit.title} style={({ pressed }) => StyleSheet.flatten([styles.resultCard, pressed && styles.pressed])}>
            <View style={[styles.resultIcon, { backgroundColor: tone.soft }]}>
              <AppIcon name={hit.icon ?? module.icon} size={icon.sm} color={tone.on} />
            </View>
            <View style={styles.resultCopy}>
              <Text numberOfLines={2} style={styles.resultTitle}>{hit.title}</Text>
              {hit.subtitle ? <Text numberOfLines={1} style={styles.meta}>{hit.subtitle}</Text> : null}
            </View>
            <AppIcon name="chevron-right" size={icon.md} color={colors.textMuted} />
          </Pressable>
        );
      }}
    />
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
    header: { paddingTop: spacing.sm, marginBottom: spacing.lg },
    back: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
    backText: { flexShrink: 0, color: colors.primary, ...typography.body, fontWeight: '800' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    titleIcon: { width: control.titleIconSize, height: control.titleIconSize, borderRadius: radius.lg, backgroundColor: accents.blue.soft, alignItems: 'center', justifyContent: 'center' },
    titleCopy: { flex: 1, minWidth: 0 },
    eyebrow: { color: colors.primary, ...typography.label, fontWeight: '700', letterSpacing: 1 },
    title: { color: colors.textPrimary, ...typography.titleLarge, fontWeight: '700', marginTop: spacing.xxs },
    subtitle: { color: colors.textSecondary, ...typography.bodySmall, marginTop: spacing.xs },
    searchBox: { minHeight: control.searchHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...elevation.card },
    input: { flex: 1, minHeight: control.inputHeight, color: colors.textPrimary, ...typography.body },
    clearButton: { width: control.iconButtonSize, height: control.iconButtonSize, alignItems: 'center', justifyContent: 'center' },
    answerCard: { marginTop: spacing.md, borderWidth: border.thin, borderColor: accents.yellow.border, borderRadius: radius.lg, backgroundColor: accents.yellow.soft, padding: spacing.md, gap: spacing.sm },
    answerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    answerText: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    answerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: border.thin, borderTopColor: accents.yellow.border, paddingTop: spacing.sm },
    answerBadge: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center' },
    answerBody: { flex: 1, minWidth: 0 },
    answerTitle: { color: colors.textPrimary, ...typography.bodySmall, fontWeight: '700' },
    answerMeta: { color: colors.textSecondary, ...typography.caption },
    answerAmount: { flexShrink: 0, color: colors.textPrimary, ...typography.bodySmall, fontWeight: '800' },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    recentWrap: { marginTop: spacing.xl },
    recentLabel: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.label.fontFamily, marginBottom: spacing.sm },
    recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    recentChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: layout.minTouchTarget, maxWidth: 200, paddingHorizontal: spacing.smd, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface },
    recentChipText: { color: colors.textPrimary, ...typography.caption },
    filterChip: { minHeight: layout.minTouchTarget, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    filterSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { color: colors.textSecondary, ...typography.caption, fontWeight: '800' },
    filterSelectedText: { color: colors.onPrimary },
    loadingRow: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
    loadingText: { color: colors.textSecondary, ...typography.bodySmall },
    sectionTitle: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.sm },
    resultCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm, ...elevation.soft },
    resultIcon: { width: spacing.lgPlus, height: spacing.lgPlus, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    resultCopy: { flex: 1, minWidth: 0 },
    resultTitle: { color: colors.textPrimary, ...typography.bodySmall, lineHeight: 20, fontWeight: '700' },
    meta: { color: colors.textMuted, ...typography.caption, marginTop: spacing.xxs },
    pressed: { opacity: opacity.pressed },
  });
}
