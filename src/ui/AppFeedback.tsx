import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import Animated, { SlideInUp, ZoomIn } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { isTechnicalMessage, logAppError } from '../services/error-log';
import { border, control, elevation, layout, opacity, radius, spacing, typography } from '../theme';

type SnackbarTone = 'success' | 'info' | 'warning' | 'danger';
type SnackbarAction = { label: string; onPress: () => void };
type SnackbarState = { id: number; message: string; tone: SnackbarTone; action?: SnackbarAction } | null;
type FeedbackContextValue = { showSnackbar: (message: string, tone?: SnackbarTone, action?: SnackbarAction) => void };
const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function AppFeedbackProvider({ children }: PropsWithChildren) {
  const [snackbar, setSnackbar] = useState<SnackbarState>(null);
  const sequence = useRef(0);
  // Many screens pass a caught error's own text straight here; a native file error read
  // "No file exists at /data/user/…". That text goes to Diagnostics instead, and the person
  // gets a sentence. Anything the app wrote itself passes through untouched.
  const { language: feedbackLanguage } = useAppPreferences();
  const showSnackbar = useCallback((message: string, tone: SnackbarTone = 'info', action?: SnackbarAction) => {
    const shown = isTechnicalMessage(message)
      ? logAppError('snackbar', new Error(message), feedbackLanguage === 'bn' ? 'কাজটি করা গেল না — আবার চেষ্টা করুন।' : 'That did not work — please try again.')
      : message;
    sequence.current += 1; setSnackbar({ id: sequence.current, message: shown, tone, action });
  }, [feedbackLanguage]);
  // An action snackbar (e.g. Undo) lingers longer so it can actually be tapped.
  useEffect(() => { if (!snackbar) return; const timeout = setTimeout(() => setSnackbar(current => current?.id === snackbar.id ? null : current), snackbar.action ? 6000 : 2600); return () => clearTimeout(timeout); }, [snackbar]);
  const dismiss = useCallback(() => setSnackbar(null), []);
  const value = useMemo(() => ({ showSnackbar }), [showSnackbar]);
  return <FeedbackContext.Provider value={value}>{children}{snackbar ? <AppSnackbar {...snackbar} onDismiss={dismiss} /> : null}</FeedbackContext.Provider>;
}
export function useAppFeedback() { const value = useContext(FeedbackContext); if (!value) throw new Error('useAppFeedback must be used inside AppFeedbackProvider'); return value; }
export function AppSnackbar({ message, tone, action, onDismiss }: { message: string; tone: SnackbarTone; action?: SnackbarAction; onDismiss?: () => void }) {
  const { colors, glass, reduceMotion } = useAppPreferences();
  const icon = tone === 'success' ? 'check-circle-outline' : tone === 'warning' ? 'alert-outline' : tone === 'danger' ? 'alert-circle-outline' : 'information-outline';
  const color = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.info;
  return (
    <View pointerEvents={action ? 'box-none' : 'none'} accessibilityLiveRegion="polite" style={styles.snackbarWrap}>
      <Animated.View entering={reduceMotion ? undefined : SlideInUp.duration(220)} style={styles.snackFull}>
        <BlurView intensity={glass.intensity} tint={glass.tint} accessible accessibilityRole={tone === 'danger' ? 'alert' : 'text'} style={[styles.snackbar, { backgroundColor: glass.scrim, borderColor: glass.border, borderTopColor: glass.highlight }]}>
          <AppIcon name={icon} size={control.iconSize} color={color} />
          <Text numberOfLines={3} style={[styles.snackbarText, { color: colors.textPrimary }]}>{message}</Text>
          {action ? (
            <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={() => { action.onPress(); onDismiss?.(); }} hitSlop={8} style={({ pressed }) => [styles.snackAction, pressed && styles.pressed]}>
              <Text style={[styles.snackActionText, { color: colors.primary }]}>{action.label}</Text>
            </Pressable>
          ) : null}
        </BlurView>
      </Animated.View>
    </View>
  );
}
type DialogIconName = ComponentProps<typeof AppIcon>['name'];
type DialogTone = 'primary' | 'danger' | 'warning' | 'success';

export function AppConfirmDialog({ visible, title, description, confirmLabel, cancelLabel, danger = false, icon, iconTone, confirmIcon, onConfirm, onCancel }: { visible: boolean; title: string; description?: string; confirmLabel: string; cancelLabel: string; danger?: boolean; icon?: DialogIconName; iconTone?: DialogTone; confirmIcon?: DialogIconName; onConfirm: () => void; onCancel: () => void }) {
  const { colors, reduceMotion } = useAppPreferences();
  const tone = iconTone ?? (danger ? 'danger' : 'primary');
  const toneColor = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.primary;
  const accent = danger ? colors.danger : colors.primary;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      {/* Solid, opaque card — no BlurView. On several Android ROMs the blur silently
          no-ops and the sheet showed see-through. Modal's own fade carries the backdrop
          in and out; the card gets a small zoom for life. */}
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={[styles.backdropScroll, { backgroundColor: colors.overlay }]} contentContainerStyle={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={cancelLabel} onPress={onCancel} />
        <Animated.View entering={reduceMotion ? undefined : ZoomIn.duration(180)} style={styles.dialogWrap}>
          <View style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {icon ? (
              <View style={[styles.dialogIcon, { backgroundColor: toneColor + '1F', borderColor: toneColor + '3D' }]}>
                <AppIcon name={icon} size={control.iconSize + 8} color={toneColor} />
              </View>
            ) : null}
            <Text maxFontSizeMultiplier={1.6} style={[styles.dialogTitle, icon ? styles.dialogTitleCentered : null, { color: colors.textPrimary }]}>{title}</Text>
            {description ? <Text maxFontSizeMultiplier={1.6} style={[styles.dialogDescription, icon ? styles.dialogTitleCentered : null, { color: colors.textSecondary }]}>{description}</Text> : null}
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => StyleSheet.flatten([styles.dialogButton, styles.dialogButtonGrow, { borderColor: colors.primary, backgroundColor: colors.surface }, pressed && styles.pressed])}>
                <Text maxFontSizeMultiplier={1.5} numberOfLines={2} style={[styles.dialogCancelText, { color: colors.primary }]}>{cancelLabel}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onConfirm} style={({ pressed }) => StyleSheet.flatten([styles.dialogButton, styles.dialogButtonGrow, styles.dialogConfirmRow, { backgroundColor: accent, borderColor: accent }, pressed && styles.pressed])}>
                {confirmIcon ? <AppIcon name={confirmIcon} size={control.iconSize - 2} color={colors.onPrimary} /> : null}
                <Text maxFontSizeMultiplier={1.5} numberOfLines={2} style={[styles.dialogConfirmText, { color: colors.onPrimary }]}>{confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </Modal>
  );
}
const styles = StyleSheet.create({ snackbarWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, zIndex: layout.feedbackZIndex, alignItems: 'center' }, snackFull: { width: '100%', alignItems: 'center' }, dialogWrap: { width: '100%', maxWidth: layout.dialogMaxWidth }, snackbar: { width: '100%', maxWidth: layout.snackbarMaxWidth, minHeight: control.buttonHeight, borderWidth: border.thin, borderRadius: radius.lg, overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, ...elevation.floating }, snackbarText: { ...typography.bodySmall, fontWeight: '700', flex: 1 }, snackAction: { minHeight: control.buttonHeight, justifyContent: 'center', paddingHorizontal: spacing.sm }, snackActionText: { ...typography.bodySmall, fontWeight: '800' }, backdropScroll: { flex: 1 }, backdrop: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }, dialog: { width: '100%', maxWidth: layout.dialogMaxWidth, borderWidth: border.thin, borderRadius: radius.xl, overflow: 'hidden', padding: spacing.lg, ...elevation.floating }, dialogIcon: { alignSelf: 'center', width: 64, height: 64, borderRadius: radius.pill, borderWidth: border.thin, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }, dialogTitle: { ...typography.dialogTitle, fontWeight: '700' }, dialogTitleCentered: { textAlign: 'center' }, dialogDescription: { ...typography.bodySmall, marginTop: spacing.sm }, dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' }, dialogButton: { minHeight: control.buttonHeight, minWidth: layout.minTouchTarget, borderWidth: border.thin, borderRadius: radius.md, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' }, dialogButtonGrow: { flex: 1, flexBasis: 120 }, dialogConfirmRow: { flexDirection: 'row', gap: spacing.xs }, dialogCancelText: { fontWeight: '800' }, dialogConfirmText: { fontWeight: '800' }, pressed: { opacity: opacity.pressed } });
