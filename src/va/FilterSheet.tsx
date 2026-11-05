import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from '../ui/AppText';
import { Chip } from '../ui/AppKit';
import { useAppPreferences } from '../app/AppPreferences';
import { radius, spacing } from '../theme';

/** A bottom sheet with a set of choice chips. Picking one calls onSelect and closes the sheet, so the page behind it keeps its place. */
export function FilterSheet<T extends string>({ visible, onClose, title, options, value, labelOf, onSelect }: {
  visible: boolean; onClose: () => void; title: string; options: readonly T[]; value: T | null; labelOf: (k: T) => string; onSelect: (k: T) => void;
}) {
  const { colors, language } = useAppPreferences();
  const insets = useSafeAreaInsets();
  const bn = language === 'bn';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} accessibilityRole="button" onPress={onClose} />
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={[styles.grab, { backgroundColor: colors.borderStrong }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            <View style={styles.row}>
              {options.map((o) => <Chip key={o} label={labelOf(o)} active={value === o} onPress={() => { onSelect(o); onClose(); }} />)}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: spacing.xs },
  title: { fontSize: 17, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingBottom: spacing.sm },
});
