import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from './AppText';
import { AppIcon, type IconName } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import type { AttachSource } from '../services/attachment-sources';
import { tapLight } from './haptics';
import { border, control, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

// B-10a: the one "add" chooser every screen uses — camera, gallery, file.
//
// rc.7 polish (the user's request): three large coloured tiles side by side instead of a
// plain list, each saying in one short line what it does, a handle that marks it as a
// sheet, a real Cancel button, and room for the phone's own navigation bar underneath.
export function AttachSourceSheet({ visible, onPick, onClose }: { visible: boolean; onPick: (source: AttachSource) => void; onClose: () => void }) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const options: { source: AttachSource; icon: IconName; label: string; hint: string; tone: 'blue' | 'green' | 'red' }[] = [
    { source: 'camera', icon: 'camera-outline', label: bn ? 'ক্যামেরা' : 'Camera', hint: bn ? 'এখনই ছবি তুলুন' : 'Take a photo now', tone: 'blue' },
    { source: 'gallery', icon: 'image-multiple-outline', label: bn ? 'গ্যালারি' : 'Gallery', hint: bn ? 'ফোনের ছবি বা ভিডিও' : 'Photos or videos', tone: 'green' },
    { source: 'file', icon: 'file-pdf-box', label: bn ? 'ফাইল' : 'File', hint: bn ? 'PDF বা যেকোনো ফাইল' : 'PDF or any file', tone: 'red' },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>{bn ? 'কী যোগ করবেন?' : 'What would you like to add?'}</Text>
          <View style={styles.subRow}>
            <AppIcon name="shield-check-outline" size={16} color={colors.textMuted} />
            <Text style={styles.subtitle}>{bn ? 'সব কিছু শুধু এই ফোনেই থাকে' : 'Everything stays on this phone'}</Text>
          </View>
          <View style={styles.row}>
            {options.map((o) => {
              const tone = accents[o.tone];
              return (
                <Pressable
                  key={o.source}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.label} — ${o.hint}`}
                  onPress={() => { tapLight(); onClose(); onPick(o.source); }}
                  style={({ pressed }) => StyleSheet.flatten([styles.tile, { borderColor: tone.border }, pressed && styles.pressed])}
                >
                  <View style={[styles.tileIcon, { backgroundColor: tone.soft }]}>
                    <AppIcon name={o.icon} size={30} color={tone.on} />
                  </View>
                  <Text numberOfLines={1} style={styles.tileLabel}>{o.label}</Text>
                  <Text numberOfLines={2} style={styles.tileHint}>{o.hint}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => StyleSheet.flatten([styles.cancel, pressed && styles.pressed])}>
            <Text style={styles.cancelText}>{bn ? 'বাতিল' : 'Cancel'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: radius.lg + 8, borderTopRightRadius: radius.lg + 8, backgroundColor: colors.surface },
    handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md },
    title: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'center' },
    subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: spacing.xxs, marginBottom: spacing.md },
    subtitle: { ...typography.caption, color: colors.textMuted },
    row: { flexDirection: 'row', gap: spacing.sm },
    tile: { flex: 1, minHeight: 132, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.lg, borderWidth: border.thin, backgroundColor: colors.background },
    tileIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    tileLabel: { ...typography.callout, fontWeight: '700', color: colors.textPrimary },
    tileHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    cancel: { minHeight: control.buttonHeight, marginTop: spacing.md, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: accents.blue.soft },
    cancelText: { ...typography.callout, fontWeight: '700', color: colors.primary },
    pressed: { opacity: 0.75 },
  });
}
