import { ComponentProps } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAppPreferences } from '../app/AppPreferences';
import { AppIcon } from './AppIcon';
import { border, radius, type AccentName } from '../theme';

// The leading visual for a list row: the item's first image if it has one, otherwise
// a filled, colour-coded icon tile. Never an empty gap.
export function RowLeading({
  thumbUri,
  icon,
  tone = 'green',
  size = 44,
}: {
  thumbUri?: string | null;
  icon: ComponentProps<typeof AppIcon>['name'];
  tone?: AccentName;
  size?: number;
}) {
  const { accents } = useAppPreferences();
  const a = accents[tone];
  if (thumbUri) {
    return <Image source={{ uri: thumbUri }} style={[styles.thumb, { width: size, height: size, borderRadius: radius.md, borderColor: a.border }]} />;
  }
  return (
    <View style={[styles.iconTile, { width: size, height: size, borderRadius: radius.md, backgroundColor: a.soft, borderColor: a.border }]}>
      <AppIcon name={icon} size={Math.round(size * 0.5)} color={a.on} />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { borderWidth: border.thin, backgroundColor: '#00000010' },
  iconTile: { borderWidth: border.thin, alignItems: 'center', justifyContent: 'center' },
});
