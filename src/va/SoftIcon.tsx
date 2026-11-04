import { View } from 'react-native';
import { AppIcon, type IconName } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';

export type SoftTone = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** An outline icon inside a softly tinted rounded square. Colours come from the active theme only. */
export function SoftIcon({ name, tone = 'primary', size = 36, color }: { name: IconName; tone?: SoftTone; size?: number; color?: string }) {
  const { colors } = useAppPreferences();
  const fg = color ?? (tone === 'neutral' ? colors.textSecondary : colors[tone]);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.34), backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
      <AppIcon name={name} size={Math.round(size * 0.55)} color={fg} />
    </View>
  );
}
