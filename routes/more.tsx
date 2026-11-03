import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '../src/ui/AppText';
import { AppIcon } from '../src/ui/AppIcon';
import { useKit } from '../src/ui/AppKit';
import { Page } from '../src/va/Page';
import { MENU } from '../src/va/menu';

/** Everything in the app as big tappable cards — the same list the side menu shows. */
export default function MoreScreen() {
  const { bn, colors } = useKit();
  return (
    <Page title={bn ? 'আরও' : 'More'} subtitle={bn ? 'অ্যাপের সব অংশ' : 'Every part of the app'}>
      {MENU.map((section) => (
        <View key={section.key} style={{ gap: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 15 }}>{bn ? section.bn : section.en}</Text>
          {section.items.map((item) => (
            <Pressable key={item.href} accessibilityRole="button" onPress={() => router.push(item.href as never)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, pressed && { opacity: 0.92 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}><AppIcon name={item.icon} size={24} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }}>{bn ? item.bn : item.en}</Text>
                <Text style={{ opacity: 0.65, fontSize: 12 }}>{bn ? item.hintBn : item.hintEn}</Text>
              </View>
              <AppIcon name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ))}
    </Page>
  );
}
