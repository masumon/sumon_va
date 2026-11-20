import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const SPLASH_DURATION_MS = 5000;

/**
 * Lightweight, self-contained 5-second opening screen with crisp inline vector mark.
 * Sits outside app providers so nothing can trap it, and shows a smooth 5s progress bar.
 */
export function Splash({ onFinish }: { onFinish: () => void }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(reduce ? 1 : 0.86);
  const lift = useSharedValue(reduce ? 1 : 0);
  const progress = useSharedValue(0);
  const [secsLeft, setSecsLeft] = useState(5);

  useEffect(() => {
    const dur = reduce ? 1200 : SPLASH_DURATION_MS;
    scale.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    lift.value = withDelay(300, withTiming(1, { duration: 500 }));
    progress.value = withTiming(1, { duration: dur, easing: Easing.linear });
    const iv = setInterval(() => {
      setSecsLeft((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    const t = setTimeout(onFinish, dur);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [onFinish, reduce, scale, lift, progress]);

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: 0.25 + 0.75 * scale.value }));
  const footStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(progress.value * 100)}%` }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#0F172A', '#1E3A8A', '#0D9488']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <View style={styles.center}>
          <Animated.View style={[styles.mark, markStyle]}>
            <View style={styles.logoCard}>
              <Svg width={68} height={68} viewBox="0 0 64 64" fill="none">
                <Defs>
                  <SvgGrad id="lg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#38BDF8" />
                    <Stop offset="1" stopColor="#2DD4BF" />
                  </SvgGrad>
                </Defs>
                <Rect x="6" y="8" width="52" height="44" rx="16" fill="url(#lg)" fillOpacity={0.22} stroke="url(#lg)" strokeWidth={2.5} />
                <Path d="M22 28C22 23.5 25.5 20 30 20H34C38.5 20 42 23.5 42 28C42 32.5 38.5 36 34 36H26L19 42V32" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M47 13L48.6 16.4L52 18L48.6 19.6L47 23L45.4 19.6L42 18L45.4 16.4L47 13Z" fill="#FDE047" />
              </Svg>
            </View>
            <Text style={styles.name}>সুমনের ভার্চুয়াল সহকারী</Text>
            <Text style={styles.tag}>সব বার্তা, কল ও কাজ — এক জায়গায়</Text>
            <View style={styles.barTrack}>
              <Animated.View style={[styles.barFill, barStyle]} />
            </View>
            <Text style={styles.timer}>{secsLeft > 0 ? `প্রস্তুত হচ্ছে... ${secsLeft} সেকেন্ড` : 'প্রস্তুত ✓'}</Text>
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
  logoCard: {
    width: 104,
    height: 104,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 8, fontFamily: 'NotoSansBengali_700Bold' },
  tag: { color: 'rgba(255,255,255,0.82)', fontSize: 13.5, textAlign: 'center', fontFamily: 'NotoSansBengali_400Regular' },
  barTrack: { width: 190, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', backgroundColor: '#5EEAD4', borderRadius: 3 },
  timer: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontFamily: 'NotoSansBengali_400Regular' },
  foot: { paddingBottom: 44, alignItems: 'center' },
  powered: { color: 'rgba(255,255,255,0.72)', fontSize: 12, letterSpacing: 0.4 },
  poweredBold: { color: '#FFFFFF', fontWeight: '700' },
});
