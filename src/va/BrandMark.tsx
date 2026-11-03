import { Image, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../ui/AppText';
import { useAppPreferences } from '../app/AppPreferences';

const LOGO = require('../../assets/icon.png');

/** The app's logo and name. Splash, sign-in and About all use this one block, so the brand can never drift between screens. */
export function BrandMark({ size = 84, showName = true, light = false }: { size?: number; showName?: boolean; light?: boolean }) {
  const { colors, language } = useAppPreferences();
  const bn = language === 'bn';
  const ink = light ? '#FFFFFF' : colors.textPrimary;
  return (
    <View style={styles.wrap}>
      <Image source={LOGO} style={{ width: size, height: size, borderRadius: size * 0.24 }} accessibilityLabel={bn ? 'সুমনের ভার্চুয়াল সহকারী' : "Sumon's Virtual Assistant"} />
      {showName ? (
        <>
          <Text style={[styles.name, { color: ink }]}>{bn ? 'সুমনের ভার্চুয়াল সহকারী' : "Sumon's Virtual Assistant"}</Text>
          <Text style={[styles.tag, { color: light ? 'rgba(255,255,255,0.75)' : colors.textMuted }]}>{bn ? 'সব বার্তা, এক জায়গায়' : 'All your messages, one place'}</Text>
        </>
      ) : null}
    </View>
  );
}

/** "Powered by ABO ENTERPRISE" — the maker's line, shown at the foot of splash, sign-in and About. */
export function PoweredBy({ light = false }: { light?: boolean }) {
  const { colors } = useAppPreferences();
  const ink = light ? 'rgba(255,255,255,0.7)' : colors.textMuted;
  return (
    <Text style={[styles.powered, { color: ink }]}>
      Powered by <Text style={{ fontWeight: '700', color: light ? '#FFFFFF' : colors.primary }}>ABO ENTERPRISE</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  name: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  tag: { fontSize: 14, textAlign: 'center' },
  powered: { fontSize: 12, textAlign: 'center', letterSpacing: 0.4 },
});
