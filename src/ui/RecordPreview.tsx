// What a record says, before anything can change it.
//
// The health lists each held a form that opened the moment a row was touched, so reading
// "what did that test cost" put the row into an editable state with a Save button under
// it. Reading and changing are different intentions. This sheet answers the first one and
// keeps the second behind a deliberate tap.
//
// It is one component rather than three screens because these lists already own their
// form: the sheet hands the record back to `onEdit`, which opens the same form that was
// always there. Nothing here writes, and the destructive action is routed to the caller's
// existing confirmation rather than performing anything itself.

import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { AppText as Text } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { border, control, elevation, icon as iconSize, layout, radius, spacing, typography } from '../theme';

/** One line of the record. A row with no value is dropped, so callers can pass everything. */
export type PreviewRow = { label: string; value: string | null | undefined; strong?: boolean };

export function RecordPreview({
  visible, title, subtitle, icon, rows, headline, headlineLabel,
  editLabel, deleteLabel, onEdit, onDelete, onClose, editIcon = 'pencil-outline',
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  icon?: IconName;
  rows: PreviewRow[];
  /** The one figure worth reading first — a cost, a total. */
  headline?: string;
  headlineLabel?: string;
  editLabel: string;
  /** Omitted where deleting happens on the page the primary action opens. */
  deleteLabel?: string;
  onEdit: () => void;
  onDelete?: () => void;
  /** "Open" rather than "Edit" where the primary action goes to a full page. */
  editIcon?: IconName;
  onClose: () => void;
}) {
  const { colors, reduceMotion, language } = useAppPreferences();
  const bn = language === 'bn';
  const shown = rows.filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim() !== '');

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, { backgroundColor: colors.overlay }]}
        contentContainerStyle={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} onPress={onClose} />
        <Animated.View entering={reduceMotion ? undefined : ZoomIn.duration(180)} style={styles.wrap}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.head}>
              {icon ? (
                <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
                  <AppIcon name={icon} size={control.iconSize} color={colors.primary} />
                </View>
              ) : null}
              <View style={styles.headCopy}>
                <Text maxFontSizeMultiplier={1.6} style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'}
                onPress={onClose}
                style={({ pressed }) => StyleSheet.flatten([styles.close, { borderColor: colors.border }, pressed && styles.pressed])}
              >
                <AppIcon name="close" size={iconSize.sm} color={colors.textSecondary} />
              </Pressable>
            </View>

            {headline ? (
              <View style={styles.headline}>
                <Text numberOfLines={1} style={[styles.headlineValue, { color: colors.textPrimary }]}>{headline}</Text>
                {headlineLabel ? <Text style={[styles.subtitle, { color: colors.textMuted }]}>{headlineLabel}</Text> : null}
              </View>
            ) : null}

            {shown.map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{row.label}</Text>
                <Text style={[styles.rowValue, { color: row.strong ? colors.textPrimary : colors.textSecondary }]}>{row.value}</Text>
              </View>
            ))}

            {/* One primary action, then the destructive one — never side by side. */}
            <Pressable
              accessibilityRole="button"
              onPress={onEdit}
              style={({ pressed }) => StyleSheet.flatten([styles.primary, { backgroundColor: colors.primary }, pressed && styles.pressed])}
            >
              <AppIcon name={editIcon} size={iconSize.sm} color={colors.onPrimary} />
              <Text numberOfLines={1} style={[styles.primaryText, { color: colors.onPrimary }]}>{editLabel}</Text>
            </Pressable>
            {onDelete && deleteLabel ? <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              style={({ pressed }) => StyleSheet.flatten([styles.danger, { borderColor: colors.danger, backgroundColor: colors.surface }, pressed && styles.pressed])}
            >
              <AppIcon name="trash-can-outline" size={iconSize.sm} color={colors.danger} />
              <Text numberOfLines={1} style={[styles.dangerText, { color: colors.danger }]}>{deleteLabel}</Text>
            </Pressable> : null}
          </View>
        </Animated.View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  backdrop: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  wrap: { width: '100%', maxWidth: layout.dialogMaxWidth },
  sheet: { width: '100%', borderWidth: border.thin, borderRadius: radius.xl, padding: spacing.lg, ...elevation.floating },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: control.smallIconContainer, height: control.smallIconContainer, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  headCopy: { flex: 1, minWidth: 0 },
  title: { ...typography.dialogTitle, fontWeight: '700' },
  subtitle: { ...typography.caption, marginTop: 2 },
  close: { width: layout.minTouchTarget, height: layout.minTouchTarget, borderWidth: border.thin, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  headline: { marginTop: spacing.md },
  headlineValue: { ...typography.title, fontFamily: typography.numeric.fontFamily },
  row: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  rowLabel: { ...typography.bodySmall, flex: 1, minWidth: 0 },
  rowValue: { ...typography.callout, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  primary: { minHeight: control.buttonHeight, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.md },
  primaryText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
  danger: { minHeight: control.buttonHeight, borderWidth: border.thin, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  dangerText: { ...typography.callout, fontWeight: '800', flexShrink: 1 },
  pressed: { opacity: 0.85 },
});
