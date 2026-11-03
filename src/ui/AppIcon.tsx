import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { useAppPreferences } from '../app/AppPreferences';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

export function AppIcon({ name, size = 22, color, accessibilityLabel }: AppIconProps) {
  const { colors } = useAppPreferences();
  const labelled = Boolean(accessibilityLabel);
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color ?? colors.textSecondary}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={labelled ? 'yes' : 'no'}
    />
  );
}
