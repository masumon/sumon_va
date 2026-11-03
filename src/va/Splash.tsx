import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useAppPreferences } from '../app/AppPreferences';
import { BrandMark, PoweredBy } from './BrandMark';

/** A short, calm opening: the mark settles in, the maker's line appears, then it fades away. */
export function Splash({ onFinish }: { onFinish: () => void }) {
  const { reduceMotion } = useAppPreferences();
  const scale = useSharedValue(reduceMotion ? 1 : 0.86);
  const lift = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    scale.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
    lift.value = withDelay(350, withTiming(1, { duration: 500 }));
    const t = setTimeout(onFinish, reduceMotion ? 700 : 1700);
    return () => clearTimeout(t);
  }, [onFinish, reduceMotion, scale, lift]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: 0.2 + 0.8 * scale.value }));
  const footStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  return (
    <Animated.View style={StyleSheet.absoluteFill} exiting={reduceMotion ? undefined : FadeOut.duration(300)} entering={FadeIn.duration(120)}>
      <LinearGradient colors={['#2B3A86', '#1E2B6B', '#0E1533']} style={styles.fill}>
        <View style={styles.center}>
          <Animated.View style={markStyle}><BrandMark size={112} light /></Animated.View>
        </View>
        <Animated.View style={[styles.foot, footStyle]}><PoweredBy light /></Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  foot: { paddingBottom: 44 },
});
