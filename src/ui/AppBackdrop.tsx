import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useAppPreferences } from '../app/AppPreferences';

/**
 * The soft colour glow behind a screen (the "aurora" of the chosen design). It is drawn once per screen, inside that
 * screen, so it slides with the screen during a transition and never shows two backgrounds at once. Without blobs
 * (low-light mode) it is just the plain background colour.
 */
export function AppBackdrop() {
  const { design, colors } = useAppPreferences();
  const blobs = design.blobs;
  if (blobs.length === 0) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          {blobs.map((b, i) => (
            <RadialGradient key={`g${i}`} id={`blob${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={b.color} stopOpacity={b.alpha} />
              <Stop offset="1" stopColor={b.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={design.baseColor} />
        {blobs.map((b, i) => <Circle key={`c${i}`} cx={b.cx} cy={b.cy} r={b.r} fill={`url(#blob${i})`} />)}
      </Svg>
    </View>
  );
}
