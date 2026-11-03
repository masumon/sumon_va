import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import { useSQLiteContext } from 'expo-sqlite';
import { useSubtaskStore } from '../store/subtask.store';
import { useAppPreferences } from '../app/AppPreferences';
import { AppIcon } from './AppIcon';
import { taskCopy } from '../i18n/task';
import { border, control, icon, layout, opacity, radius, spacing, typography, type ThemeColors } from '../theme';

export function SubtaskList({ taskId, onAllComplete }: { taskId: string; onAllComplete?: () => void }) {
  const db = useSQLiteContext();
  const { colors, language } = useAppPreferences();
  const copy = taskCopy(language);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = useSubtaskStore((s) => s.byTask[taskId]);
  const load = useSubtaskStore((s) => s.load);
  const add = useSubtaskStore((s) => s.add);
  const toggle = useSubtaskStore((s) => s.toggle);
  const remove = useSubtaskStore((s) => s.remove);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(db, taskId); }, [db, taskId, load]);

  const list = items ?? [];
  const done = list.filter((item) => item.completed).length;
  const total = list.length;

  const submit = async () => {
    const value = draft.trim();
    if (!value || busy) return;
    setBusy(true);
    try { if (await add(db, taskId, value)) setDraft(''); } finally { setBusy(false); }
  };
  const onToggle = async (id: string, next: boolean) => {
    await toggle(db, taskId, id, next);
    const after = useSubtaskStore.getState().byTask[taskId] ?? [];
    if (after.length > 0 && after.every((item) => item.completed)) onAllComplete?.();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{copy.subtasks}</Text>
        {total > 0 ? <Text style={styles.progress}>{copy.subtasksProgress(done, total)}</Text> : null}
      </View>

      {total > 0 ? (
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round((done / total) * 100)}%` }]} /></View>
      ) : null}

      {list.map((item) => (
        <View key={item.id} style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            accessibilityLabel={item.title}
            onPress={() => void onToggle(item.id, !item.completed)}
            hitSlop={6}
            style={({ pressed }) => StyleSheet.flatten([styles.check, item.completed && styles.checkOn, pressed && styles.pressed])}
          >
            {item.completed ? <AppIcon name="check" size={icon.xs} color={colors.onPrimary} /> : null}
          </Pressable>
          <Text style={[styles.rowText, item.completed && styles.rowTextDone]} numberOfLines={3}>{item.title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${copy.removeStep}: ${item.title}`} onPress={() => void remove(db, taskId, item.id)} hitSlop={6} style={({ pressed }) => StyleSheet.flatten([styles.del, pressed && styles.pressed])}>
            <AppIcon name="close" size={icon.xs} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}

      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void submit()}
          editable={!busy}
          placeholder={copy.stepPlaceholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          style={styles.input}
          accessibilityLabel={copy.addStep}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.addStep}
          accessibilityState={{ disabled: !draft.trim() || busy, busy }}
          disabled={!draft.trim() || busy}
          onPress={() => void submit()}
          style={({ pressed }) => StyleSheet.flatten([styles.addBtn, (!draft.trim() || busy) && styles.disabled, pressed && styles.pressed])}
        >
          {busy ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <AppIcon name="plus" size={icon.sm} color={colors.onPrimary} />}
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: spacing.lg, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
    title: { color: colors.textPrimary, ...typography.cardTitle, fontWeight: '900' },
    progress: { color: colors.textSecondary, ...typography.caption, fontFamily: typography.numeric.fontFamily },
    track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
    fill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
    row: { minHeight: control.rowMinHeight - spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    check: { width: layout.minTouchTarget - spacing.md, height: layout.minTouchTarget - spacing.md, borderRadius: radius.sm, borderWidth: border.medium, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: colors.success, borderColor: colors.success },
    rowText: { flex: 1, minWidth: 0, color: colors.textPrimary, ...typography.bodySmall },
    rowTextDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
    del: { width: layout.minTouchTarget - spacing.md, height: layout.minTouchTarget - spacing.md, alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    input: { flex: 1, minHeight: control.buttonHeight, borderWidth: border.thin, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, color: colors.textPrimary, paddingHorizontal: spacing.md, ...typography.bodySmall },
    addBtn: { width: control.buttonHeight, height: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: opacity.pressed },
  });
}
