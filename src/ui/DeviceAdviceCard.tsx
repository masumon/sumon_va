import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { AppIcon } from './AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { loadProfile, modelAdvice, speedLine } from '../ai/model/device-profile';
import { border, radius, spacing, typography, type ThemeAccents, type ThemeColors } from '../theme';

function phoneRam(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-device') as { totalMemory?: number | null }).totalMemory ?? null;
  } catch { return null; }
}
function freeSpace(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Paths } = require('expo-file-system') as { Paths: { availableDiskSpace?: number } };
    return typeof Paths.availableDiskSpace === 'number' ? Paths.availableDiskSpace : null;
  } catch { return null; }
}

/** "Which model suits this phone" — from its RAM, free space and measured speed. */
export function DeviceAdviceCard() {
  const { colors, accents, language } = useAppPreferences();
  const bn = language === 'bn';
  const styles = useMemo(() => makeStyles(colors, accents), [colors, accents]);
  const lines = useMemo(() => {
    const speed = speedLine(loadProfile(), bn);
    return [...modelAdvice(phoneRam(), freeSpace(), bn), ...(speed ? [speed] : [])];
  }, [bn]);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <AppIcon name="cellphone-cog" size={20} color={colors.primary} />
        <Text style={styles.title}>{bn ? 'এই ফোনের জন্য পরামর্শ' : 'Advice for this phone'}</Text>
      </View>
      {lines.map((line, i) => <Text key={i} style={styles.line}>• {line}</Text>)}
    </View>
  );
}

function makeStyles(colors: ThemeColors, accents: ThemeAccents) {
  return StyleSheet.create({
    card: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: border.thin, borderColor: accents.blue.border, backgroundColor: accents.blue.soft, gap: spacing.xs },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { flex: 1, ...typography.callout, fontWeight: '700', color: colors.textPrimary },
    line: { ...typography.bodySmall, color: colors.textPrimary },
  });
}
