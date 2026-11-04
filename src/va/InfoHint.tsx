import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';

/** A small "i" button. Tapping it shows or hides the longer help text. */
export function InfoHint({ text }: { text: string }) {
  const { colors, language } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const label = language === 'bn' ? 'বিস্তারিত' : 'More info';
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: colors.surfaceMuted }}>
        <AppIcon name={open ? 'information' : 'information-outline'} size={18} color={colors.info} />
        <Text style={{ fontSize: 12, color: colors.textSecondary }}>{label}</Text>
      </Pressable>
      {open ? <Text style={{ fontSize: 13, lineHeight: 20, color: colors.textSecondary }}>{text}</Text> : null}
    </View>
  );
}
