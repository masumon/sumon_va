import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const LOGO = require('../../assets/icon.png');

/**
 * The opening screen. It is deliberately SELF-CONTAINED: no preferences, no providers. It sits next to the app, not inside it,
 * so nothing the app does (database, language, theme) can keep it on screen — it only depends on its own timer.
 */
export function Splash({ onFinish }: { onFinish: () => void }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(reduce ? 1 : 0.86);
  const lift = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    scale.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
    lift.value = withDelay(350, withTiming(1, { duration: 500 }));
    const t = setTimeout(onFinish, reduce ? 700 : 1700);
    return () => clearTimeout(t);
  }, [onFinish, reduce, scale, lift]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: 0.2 + 0.8 * scale.value }));
  const footStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  return (
    // pointerEvents=none: even if it were ever left on screen it could never block a tap.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#2B3A86', '#1E2B6B', '#0E1533']} style={styles.fill}>
        <View style={styles.center}>
          <Animated.View style={[styles.mark, markStyle]}>
            <Image source={LOGO} style={styles.logo} />
            <Text style={styles.name}>সুমনের ভার্চুয়াল সহকারী</Text>
            <Text style={styles.tag}>সব বার্তা, এক জায়গায়</Text>
          </Animated.View>
        </View>
        <Animated.View style={[styles.foot, footStyle]}>
          <Text style={styles.powered}>Powered by <Text style={styles.poweredBold}>ABO ENTERPRISE</Text></Text>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mark: { alignItems: 'center', gap: 10 },
  logo: { width: 112, height: 112, borderRadius: 27 },
  name: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 6, fontFamily: 'NotoSansBengali_700Bold' },
  tag: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center', fontFamily: 'NotoSansBengali_400Regular' },
  foot: { paddingBottom: 44, alignItems: 'center' },
  powered: { color: 'rgba(255,255,255,0.7)', fontSize: 12, letterSpacing: 0.4 },
  poweredBold: { color: '#FFFFFF', fontWeight: '700' },
});
