import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { discardOcrImage } from '../services/ocr-service';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { tapLight } from './haptics';
import { border, control, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

/**
 * The lines a photo gave back, to keep or leave out before they reach the box (rc.13 QA G03).
 *
 * A page carries more than the part wanted — a letterhead, a second column, a stamp. Every
 * line starts ticked; untick what is not wanted and the rest arrive in the page's own
 * order. Android's crop screen is not used for this: it showed no visible OK button on the
 * user's phone (RC.2), and ticking lines needs nothing but this sheet.
 */
export function OcrLinePicker({ text, note, imageUri, onDone, onClose }: { text: string | null; note?: string | null; imageUri?: string | null; onDone: (picked: string) => void; onClose: () => void }) {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const lines = useMemo(() => (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean), [text]);
  // A fresh set per photo: the parent keys this component by the text it shows.
  const [off, setOff] = useState<Set<number>>(new Set());
  const kept = lines.filter((_, i) => !off.has(i));
  const toggle = (i: number) => { tapLight(); setOff((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; }); };
  const count = bn ? String(kept.length).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!) : String(kept.length);

  return (
    <Modal visible={text !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={bn ? 'বন্ধ করুন' : 'Close'} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>{bn ? 'কোন লাইনগুলো রাখবেন?' : 'Which lines to keep?'}</Text>
          <Text style={styles.subtitle}>{bn ? 'যেটা লাগবে না, তাতে চাপ দিয়ে বাদ দিন। বাকিগুলো ছবির ক্রমেই বসবে।' : 'Tap a line to leave it out. The rest arrive in the page’s order.'}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {/* The photo itself, to compare the lines against (rc.13 QA G03: "preview, then pick"). */}
          {imageUri ? <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="contain" accessibilityLabel={bn ? 'তোলা ছবি' : 'The photo'} /> : null}
          <View style={styles.bulk}>
            <Pressable accessibilityRole="button" onPress={() => setOff(new Set())} style={({ pressed }) => StyleSheet.flatten([styles.bulkBtn, pressed && styles.pressed])}>
              <Text style={styles.bulkText}>{bn ? 'সব রাখুন' : 'Keep all'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setOff(new Set(lines.map((_, i) => i)))} style={({ pressed }) => StyleSheet.flatten([styles.bulkBtn, pressed && styles.pressed])}>
              <Text style={styles.bulkText}>{bn ? 'সব বাদ' : 'Clear all'}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {lines.map((line, i) => {
              const on = !off.has(i);
              return (
                <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(i)} style={({ pressed }) => StyleSheet.flatten([styles.line, on && styles.lineOn, pressed && styles.pressed])}>
                  <AppIcon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
                  <Text style={[styles.lineText, !on && styles.lineTextOff]}>{line}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.bar}>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => StyleSheet.flatten([styles.cancel, pressed && styles.pressed])}>
              <Text style={styles.cancelText}>{bn ? 'বাতিল' : 'Cancel'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!kept.length} onPress={() => { tapLight(); onDone(kept.join('\n')); }} style={({ pressed }) => StyleSheet.flatten([styles.primary, !kept.length && styles.disabled, pressed && styles.pressed])}>
              <Text numberOfLines={1} style={styles.primaryText}>{bn ? `${count}টি লাইন বসান` : `Use ${count} line${kept.length === 1 ? '' : 's'}`}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { maxHeight: '88%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: radius.lg + 8, borderTopRightRadius: radius.lg + 8, backgroundColor: colors.surface },
    handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md },
    title: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'center' },
    subtitle: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxs },
    note: { ...typography.caption, color: colors.warning, textAlign: 'center', marginTop: spacing.xxs },
    bulk: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginVertical: spacing.sm },
    bulkBtn: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    bulkText: { ...typography.meta, fontWeight: '700', color: colors.primary },
    photo: { width: '100%', height: 160, borderRadius: radius.md, marginTop: spacing.sm, backgroundColor: colors.surfaceMuted },
    list: { flexGrow: 0 },
    listContent: { gap: spacing.xs, paddingBottom: spacing.sm },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, backgroundColor: colors.background },
    lineOn: { borderColor: accents.blue.border, backgroundColor: accents.blue.soft },
    lineText: { flex: 1, ...typography.body, color: colors.textPrimary },
    lineTextOff: { color: colors.textMuted, textDecorationLine: 'line-through' },
    bar: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    cancel: { minHeight: control.buttonHeight, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: border.thin, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    cancelText: { ...typography.callout, fontWeight: '700', color: colors.textSecondary },
    primary: { flex: 1, minHeight: control.buttonHeight, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
    primaryText: { ...typography.callout, fontWeight: '700', color: colors.onPrimary },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
  });
}

/**
 * The one way every screen offers photo lines to pick (Home, আপন, prescriptions): more than
 * two lines open the picker with the photo; one or two go straight in. The kept photo is
 * deleted when the picker closes either way.
 */
export function useOcrLinePicker(): { offer: (text: string, note: string | null, imageUri: string | undefined, apply: (picked: string) => void) => void; picker: ReactElement } {
  const [pick, setPick] = useState<{ text: string; note: string | null; imageUri?: string; apply: (picked: string) => void } | null>(null);
  const offer = useCallback((text: string, note: string | null, imageUri: string | undefined, apply: (picked: string) => void) => {
    if (text.split('\n').filter((l) => l.trim()).length <= 2) { apply(text); discardOcrImage(imageUri); return; }
    setPick({ text, note, imageUri, apply });
  }, []);
  const close = () => { discardOcrImage(pick?.imageUri); setPick(null); };
  const picker = (
    <OcrLinePicker
      key={pick?.text ?? 'none'}
      text={pick?.text ?? null}
      note={pick?.note}
      imageUri={pick?.imageUri}
      onClose={close}
      onDone={(picked) => { pick?.apply(picked); close(); }}
    />
  );
  return { offer, picker };
}
