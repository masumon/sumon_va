import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '../ui/AppText';
import { AppIcon } from '../ui/AppIcon';
import { useAppPreferences } from '../app/AppPreferences';
import { DESIGN_INFO } from '../theme/designs';
import { spacing } from '../theme';

/** Settings → ডিজাইন-থিম: three complete looks. Each one still follows the day / night / system mode chosen below it. */
export function DesignPicker() {
  const { colors, design, designId, setDesignTheme, language } = useAppPreferences();
  const bn = language === 'bn';
  return (
    <View style={{ gap: spacing.smd }} accessibilityRole="radiogroup">
      {DESIGN_INFO.map((d) => {
        const on = d.id === designId;
        return (
          <Pressable key={d.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${bn ? d.bn : d.en}. ${bn ? d.hintBn : d.hintEn}`}
            onPress={() => { if (!on) void setDesignTheme(d.id); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 72, padding: spacing.smd, borderRadius: design.radiusCard, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primaryTint : colors.surface, opacity: pressed ? 0.92 : 1 })}>
            <LinearGradient colors={[d.swatch[0], d.swatch[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: d.swatch[2], borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' }} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700' }}>{bn ? d.bn : d.en}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 18 }}>{bn ? d.hintBn : d.hintEn}</Text>
            </View>
            {on ? <AppIcon name="check-circle" size={24} color={colors.primary} /> : <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong }} />}
          </Pressable>
        );
      })}
    </View>
  );
}
