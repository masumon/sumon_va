// The launch hand-off: the mark writes itself, then gets out of the way.
//
// What was here before threw nine small copies of the logo around the screen like
// confetti. That animation was built for a bare abstract spark, and once the spark became
// the actual logo it read as clutter — the opposite of what a launch screen is for. So
// this is one thing, drawn once.
//
// The motion is the mark being written the way you would write it by hand: the ring
// sweeps round from the opening, then the letter arrives inside it. Nothing else moves.
//
// Hard rule for a launch screen: whatever plays every single day cannot be long. This one
// is 1.25s from black to app, and the last 250ms overlap the app fading in underneath, so
// the perceived wait is shorter still. And if the phone is set to reduce motion, none of
// it plays — the finished mark simply appears, because a person who gets motion sickness
// should not have to endure a flourish to open their own notebook.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from './AppText';
import { APON_RING } from './AponMark';
import { AppIcon } from './AppIcon';

// Exact colours sampled from the brand's own logo file, not approximated — the mark this
// screen draws must be the same navy and the same gold as the one on every icon.
const BRAND = '#0C3C85';
const GOLD = '#F4C54F';
const CREDIT = 'POWERED BY ABO ENTERPRISE';
const VERSION = `v${Constants.expoConfig?.version ?? ''}`.replace(/v$/u, '');
const SLOGAN = 'যা কিছু আপনার — সবই আপন';

/**
 * The life the app actually holds, drifting across the whole screen.
 *
 * Not decoration for its own sake: a launch screen is the one moment to say what this
 * thing is for, and "tasks, money, debt, health, memories, people" said in six small
 * icons is faster to read than any sentence. Each keeps its own module's colour, so the
 * screen is the first place a person meets the colour they will later navigate by.
 *
 * Positions are fractions of the screen (0–1), gathered close around the mark rather than
 * scattered to the corners — the eight should read as things orbiting the logo, not
 * decorating the screen's edges. `xFrac` still keeps clear of the centre column the mark,
 * word and slogan occupy, and `yFrac` keeps clear of the status bar above and the credit
 * line below. Unequal periods so the eight never line up into an obvious beat — the
 * movement should read as things floating, not marching.
 */
type OrbitBehaviour =
  // Rises and falls in place.
  | 'sway'
  // Drifts gently side to side — a different axis from `sway`, so not every icon moves
  // the same way.
  | 'glide'
  // Rocks a hair — never more than about two degrees, which is the difference between
  // "gently alive" and "a loading spinner nobody asked for" on a small badge.
  | 'tilt'
  // A faint diagonal wander — a little of both axes at once, its own quiet path.
  | 'diagonal';

// Positions are fractions of the screen (0-1), deliberately not mirrored left-to-right —
// a matching icon at the same height on each side reads as a grid; offsetting every pair
// by a few points of height and reach is what makes the ring around the mark read as
// gathered rather than laid out. Held in close (roughly a quarter to three-quarters of the
// width, never further out) so the eight read as orbiting the mark rather than pinned to
// the screen's corners. `driftX`/`driftY` (dp) are kept to 2-4 and `rotateDeg` to about a
// degree and a half — this is a splash a person sees every single day, so the motion has
// to stay in the background of their attention, not call for it. `delay` staggers each
// icon's very first loop start, so eight icons on the same handful of periods never happen
// to swing through the same point at the same moment.
const ORBIT: {
  icon: Parameters<typeof AppIcon>[0]['name']; colour: string; xFrac: number; yFrac: number;
  period: number; delay: number; driftX: number; driftY: number; rotateDeg: number;
  behaviour: OrbitBehaviour; size: number;
}[] = [
  { icon: 'checkbox-marked-circle-outline', colour: '#5FB2E6', xFrac: 0.28, yFrac: 0.28, period: 4600, delay: 0, driftX: 0, driftY: 3, rotateDeg: 0, behaviour: 'sway', size: 26 },
  { icon: 'wallet-outline', colour: '#46CE86', xFrac: 0.72, yFrac: 0.29, period: 5400, delay: 700, driftX: 3, driftY: 0, rotateDeg: 0, behaviour: 'glide', size: 27 },
  { icon: 'heart-pulse', colour: '#F0736A', xFrac: 0.23, yFrac: 0.46, period: 5000, delay: 1300, driftX: 2, driftY: 3, rotateDeg: 0, behaviour: 'diagonal', size: 27 },
  { icon: 'bookmark-outline', colour: '#AB9AE2', xFrac: 0.77, yFrac: 0.41, period: 6000, delay: 400, driftX: 0, driftY: 0, rotateDeg: 1.6, behaviour: 'tilt', size: 26 },
  { icon: 'calendar-month-outline', colour: '#7FD1C6', xFrac: 0.26, yFrac: 0.61, period: 5200, delay: 2200, driftX: 2, driftY: 2, rotateDeg: 0, behaviour: 'diagonal', size: 27 },
  { icon: 'magnify', colour: '#F0A85F', xFrac: 0.74, yFrac: 0.59, period: 4400, delay: 1100, driftX: 0, driftY: 0, rotateDeg: 1.2, behaviour: 'tilt', size: 26 },
  { icon: 'account-multiple-outline', colour: '#F4C54F', xFrac: 0.34, yFrac: 0.68, period: 4800, delay: 1800, driftX: 0, driftY: 4, rotateDeg: 0, behaviour: 'sway', size: 28 },
  { icon: 'bell-outline', colour: '#5FB2E6', xFrac: 0.66, yFrac: 0.70, period: 5600, delay: 900, driftX: 4, driftY: 0, rotateDeg: 0, behaviour: 'glide', size: 27 },
];

const MARK_SIZE = 132;
/** How long it lasts, black to app. Long by design; a tap ends it at any moment. */
// Ten seconds, as asked for. Long for something seen daily, so a tap anywhere ends it at
// any moment and the whole view is `box-none` — it never swallows a touch it did not ask
// for, which is what made the app feel frozen when it lingered a frame too long.
const TOTAL_MS = 10_000;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);


/**
 * One drifting icon. Fades in late, then rises and falls on its own slow loop.
 *
 * `reduceMotion` stops the loop rather than the icon: someone who asked the phone for
 * less movement should still see what the app is for.
 */
function OrbitIcon({
  spec, progress, reduceMotion, width, height,
}: {
  spec: (typeof ORBIT)[number];
  progress: Animated.Value;
  reduceMotion: boolean;
  width: number;
  height: number;
}) {
  // `useMemo`, like every other driver in this file — a ref read during render is
  // both a lint error and a value nothing can drive.
  const float = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: spec.period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: spec.period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    // Offsets this icon's very first swing by its own `delay` before the loop starts, so
    // eight icons sharing a handful of similar periods never happen to be in the same
    // part of their cycle at once — without this every icon reads as one animation
    // wearing eight costumes rather than eight things each quietly alive on their own.
    const timer = setTimeout(() => loop.start(), spec.delay);
    return () => { clearTimeout(timer); loop.stop(); };
  }, [float, spec.period, spec.delay, reduceMotion]);

  // A fraction of the actual screen, not the mark's own box — this is what makes the
  // icons read as spread across the whole launch screen on any phone, not just a wide one.
  const left = width * spec.xFrac - spec.size / 2;
  const top = height * spec.yFrac - spec.size / 2;

  // One driver, one, two, or three of its component axes — a vertical rise-and-fall, a
  // horizontal drift, a two-degree rock, or a faint diagonal wander, depending on which
  // icon it is. Deliberately small: this plays on a screen someone sees every day, so it
  // has to stay at the edge of notice rather than draw the eye the way the mark itself
  // does. Scale is left alone entirely outside the one-time entrance below — a
  // continuously breathing badge is exactly the "flashy" this was asked not to be.
  const entranceScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const motionTransform: (
    | { translateY: Animated.AnimatedInterpolation<number> }
    | { translateX: Animated.AnimatedInterpolation<number> }
    | { rotate: Animated.AnimatedInterpolation<string> }
  )[] = [];
  if (spec.driftY) motionTransform.push({ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [spec.driftY, -spec.driftY] }) });
  if (spec.driftX) motionTransform.push({ translateX: float.interpolate({ inputRange: [0, 1], outputRange: [-spec.driftX, spec.driftX] }) });
  if (spec.rotateDeg) motionTransform.push({ rotate: float.interpolate({ inputRange: [0, 1], outputRange: [`-${spec.rotateDeg}deg`, `${spec.rotateDeg}deg`] }) });

  return (
    // Two views on purpose: the outer one holds the fixed place on screen with a plain
    // style, the inner one carries everything that moves. Composing a static offset into
    // an animated transform meant building an `Animated.Value` during render, which is a
    // value created fresh on every pass and never driven by anything.
    <View pointerEvents="none" style={[styles.orbit, { left, top }]}>
      <Animated.View
        style={{
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9] }),
          transform: [...motionTransform, { scale: entranceScale }],
        }}
      >
        <View
          style={[
            styles.orbitBadge,
            { width: spec.size, height: spec.size, borderRadius: spec.size / 2, borderColor: `${spec.colour}55`, backgroundColor: `${spec.colour}1F` },
          ]}
        >
          <AppIcon name={spec.icon} size={Math.round(spec.size * 0.5)} color={spec.colour} />
        </View>
      </Animated.View>
    </View>
  );
}

export function AnimatedSplash({ onFinish }: { onFinish?: () => void }) {
  const { width, height } = useWindowDimensions();
  // One driver per thing that moves, so each can have its own curve. They are cheap:
  // five values, no layout animation, and every one of them uses the native driver
  // except the ring, whose strokeDasharray SVG cannot hand to the UI thread.
  const ring = useMemo(() => new Animated.Value(0), []);
  const letter = useMemo(() => new Animated.Value(0), []);
  const wordmark = useMemo(() => new Animated.Value(0), []);
  const slogan = useMemo(() => new Animated.Value(0), []);
  const cover = useMemo(() => new Animated.Value(1), []);
  const lift = useMemo(() => new Animated.Value(1), []);
  const breath = useMemo(() => new Animated.Value(0), []);
  // Two ripples, not one: `halo2` starts partway through `halo`'s own expansion, so a
  // second ring is sometimes fading in while the first is fading out — a live surface,
  // never more than two rings at once, and never both at full strength together.
  const halo = useMemo(() => new Animated.Value(0), []);
  const halo2 = useMemo(() => new Animated.Value(0), []);
  const done = useRef(false);

  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (!cancelled) setReduceMotion(enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Hand over from the native splash the moment this one is on screen.
  //
  // The layout calls `preventAutoHideAsync` so the two never flash between each other,
  // which means *something* has to call `hideAsync` — and if nothing does, the app sits
  // behind the native splash forever, launching correctly and showing nothing. An earlier
  // rewrite of this file dropped the call and did exactly that.
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const finish = Animated.parallel([
      Animated.timing(lift, { toValue: 1.05, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cover, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);

    if (reduceMotion) {
      // No sweep, no rise: the finished mark, held briefly, then gone.
      ring.setValue(1);
      letter.setValue(1);
      wordmark.setValue(1);
      slogan.setValue(1);
      const timer = setTimeout(() => finish.start(() => onFinish?.()), 900);
      return () => clearTimeout(timer);
    }

    const sequence = Animated.parallel([
      // The ring is written first, and it overshoots very slightly before settling —
      // which is what a stroke made by a hand does, and what a stroke made by a computer
      // does not.
      Animated.sequence([
        Animated.delay(120),
        Animated.timing(ring, { toValue: 1.02, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(ring, { toValue: 1, duration: 90, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(letter, { toValue: 1, duration: 300, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(780),
        Animated.timing(wordmark, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(950),
        Animated.timing(slogan, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);

    // Once the mark is written it does not simply sit there for eight seconds. Three
    // loops at deliberately unequal periods — a breath, a turn, a glint — so they never
    // line up into an obvious repeating beat. A still image held this long is a wait; a
    // moving one is a moment.
    const alive = Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.delay(1500),
        Animated.timing(halo, { toValue: 1, duration: 2800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
      // Offset by roughly half the first ring's expansion, then its own longer gap before
      // repeating — the two never simply alternate in lockstep, which is what would make
      // them read as one mechanical pulse instead of a soft, irregular ripple.
      Animated.loop(Animated.sequence([
        Animated.delay(2900),
        Animated.timing(halo2, { toValue: 1, duration: 2800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo2, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
    ]);

    sequence.start(() => { if (!done.current) alive.start(); });
    const timer = setTimeout(() => finish.start(() => onFinish?.()), TOTAL_MS - 700);
    return () => { clearTimeout(timer); sequence.stop(); alive.stop(); finish.stop(); };
  }, [reduceMotion, ring, letter, wordmark, slogan, cover, lift, breath, halo, halo2, onFinish]);

  const drawn = ring.interpolate({
    inputRange: [0, 1],
    outputRange: [0, APON_RING.circumference * APON_RING.sweep],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      // box-none: this view fills the screen but takes no touch of its own — only the skip
      // button below can be pressed. Without it the splash swallowed every tap, and any
      // frame where it outlived its own fade left the whole app dead to the finger with
      // nothing on screen to explain why.
      pointerEvents="box-none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fill, { opacity: cover }]}
    >
      {/* No skip button, deliberately.
          A full-screen Pressable was the tap-to-skip, and it was also the bug: `box-none`
          exempts the view that carries it, never its children, so that Pressable swallowed
          every touch for as long as the splash was mounted — and if the hand-over ever
          failed, forever. The app opened, drew perfectly, and answered nothing.
          Purely decorative is the safe shape for something that covers the whole screen:
          whatever happens to the timer, a touch always reaches the app underneath. */}
      {/* What the app holds, drifting around the mark. Rendered before it, so the mark
          always sits on top of them. */}
      {ORBIT.map((spec) => (
        <OrbitIcon
          key={`${spec.icon}-${spec.xFrac}-${spec.yFrac}`}
          spec={spec}
          progress={slogan}
          reduceMotion={reduceMotion}
          width={width}
          height={height}
        />
      ))}

      <Animated.View
        pointerEvents="none"
        style={{
          transform: [{ scale: Animated.multiply(lift, breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] })) }],
          alignItems: 'center',
        }}
      >
        {/* A slow ring of light leaving the mark, like a ripple on still water — never
            more than two of these on screen together, and each fading before it has
            spread far, so it reads as the surface being quietly alive rather than a
            pulse competing with the mark for attention. */}
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: halo.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.26, 0] }),
              transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.9] }) }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: halo2.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.22, 0] }),
              transform: [{ scale: halo2.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.9] }) }],
            },
          ]}
        />
        <View style={{ width: MARK_SIZE, height: MARK_SIZE }}>
          <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox={`0 0 ${APON_RING.view} ${APON_RING.view}`}>
            <G
              rotation={APON_RING.gapCentre + APON_RING.gapDegrees / 2}
              origin={`${APON_RING.view / 2}, ${APON_RING.view / 2}`}
            >
              <AnimatedCircle
                cx={APON_RING.view / 2}
                cy={APON_RING.view / 2}
                r={APON_RING.radius}
                stroke={GOLD}
                strokeWidth={APON_RING.stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={[APON_RING.circumference, APON_RING.circumference]}
                strokeDashoffset={Animated.subtract(APON_RING.circumference, drawn)}
              />

              {/* The mark's two ball terminals, the same as `AponMark` draws. The splash
                  was drawing a bare broken circle, which is not the logo — the launcher
                  icon has them, so the first thing the app shows must too. Both are fixed
                  here rather than one riding the sweep: this is the finished mark being
                  written, not a gauge, and a dot travelling round the rim read as a
                  loading spinner. */}
              <Circle
                cx={APON_RING.view / 2 + APON_RING.radius}
                cy={APON_RING.view / 2}
                r={APON_RING.dot}
                fill={GOLD}
              />
              <Circle
                cx={APON_RING.view / 2 + APON_RING.radius * Math.cos(APON_RING.sweep * 2 * Math.PI)}
                cy={APON_RING.view / 2 + APON_RING.radius * Math.sin(APON_RING.sweep * 2 * Math.PI)}
                r={APON_RING.dot}
                fill={GOLD}
              />
            </G>
          </Svg>

          <Animated.View
            style={[
              styles.letterSlot,
              { opacity: letter, transform: [{ scale: letter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] },
            ]}
          >
            <Text allowFontScaling={false} style={styles.letter}>আ</Text>
          </Animated.View>
        </View>

        <Animated.Text
          allowFontScaling={false}
          style={[
            styles.wordmark,
            {
              opacity: wordmark,
              transform: [{ translateY: wordmark.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          আপন
        </Animated.Text>

        <Animated.Text allowFontScaling={false} style={[styles.slogan, { opacity: slogan }]}>
          {SLOGAN}
        </Animated.Text>
      </Animated.View>

      <ShimmerCredit progress={slogan} />
    </Animated.View>
  );
}

/**
 * "POWERED BY ABO ENTERPRISE" — a soft gold shine crosses it, right then left, forever.
 *
 * A still credit line at the foot of the screen for ten seconds reads as an afterthought;
 * the same line with light moving across it reads as considered. The shine is a narrow
 * gradient band sliding under `overflow: hidden`, not the text's own colour changing — so
 * the words stay perfectly legible the whole time, and only the glint on top of them
 * moves. It waits for the rest of the screen to finish arriving before it starts.
 */
function ShimmerCredit({ progress }: { progress: Animated.Value }) {
  const [textWidth, setTextWidth] = useState(0);
  const sweep = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!textWidth) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(500),
      Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(450),
      Animated.timing(sweep, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [textWidth, sweep]);

  const band = Math.max(70, textWidth * 0.55);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-band, textWidth] });

  return (
    <Animated.View pointerEvents="none" style={[styles.creditSlot, { opacity: progress }]}>
      <View
        style={styles.creditClip}
        onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
      >
        <Text allowFontScaling={false} style={styles.credit}>{CREDIT}</Text>
        {textWidth ? (
          <Animated.View style={[styles.shimmerBand, { width: band, transform: [{ translateX }, { skewX: '-18deg' }] }]}>
            <LinearGradient
              colors={['rgba(244,197,79,0)', 'rgba(244,197,79,0.85)', 'rgba(244,197,79,0)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
      </View>
      {/* Outside the clip: the shine crosses the credit only, and the version sits still
          under it. Never typed by hand — it is the running build's own number. */}
      {VERSION ? <Text allowFontScaling={false} style={styles.version}>{VERSION}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  orbit: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  orbitBadge: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 0, width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE / 2, borderWidth: 1.5, borderColor: '#F0D48A' },
  letterSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  letter: { color: GOLD, fontSize: MARK_SIZE * 0.4, lineHeight: MARK_SIZE * 0.52, fontWeight: '700' },
  wordmark: { color: '#FFFFFF', fontSize: 34, fontWeight: '700', letterSpacing: 1, marginTop: 26 },
  slogan: { color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600', marginTop: 8, letterSpacing: 0.2 },
  // Positions the row; `creditClip` is what actually clips the moving shine to the text's
  // own width instead of the full screen.
  creditSlot: { position: 'absolute', bottom: 56, alignItems: 'center' },
  creditClip: { overflow: 'hidden' },
  credit: { color: 'rgba(255,255,255,0.62)', fontSize: 11, letterSpacing: 2.4, fontWeight: '800' },
  version: { color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: 1.2, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  shimmerBand: { position: 'absolute', top: -6, bottom: -6 },
});

export default AnimatedSplash;
