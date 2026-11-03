// The mark on Home, doing a job.
//
// What sat here before was a cartoon of a person at a desk: about forty percent of the
// hero card, a different visual language from everything else on screen, and carrying no
// information at all. It was replaced rather than restyled, because the problem was not
// how it looked.
//
// This is the same আপন mark from the launch screen and the app icon, except the ring is
// only drawn as far as today has got — so the decoration is the figure. Tapping it opens
// the day's plan, which is the natural next thing to want after reading it.
//
// The rotation is very slow on purpose. A hero that is always moving pulls the eye away
// from the words beside it; one full turn a minute reads as alive rather than as motion.

import { asciiDigitsToBengali } from '../services/debt/money';
import { memo, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { AponMark } from './AponMark';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

export interface HeroMarkProps {
  /** 0–1: how much of today's planned work is done. */
  progress: number;
  done: number;
  total: number;
  language: 'bn' | 'en';
  size?: number;
}

export const HeroMark = memo(function HeroMark({ progress, done, total, language, size = 104 }: HeroMarkProps) {
  const spin = useMemo(() => new Animated.Value(0), []);
  // Two more, at periods that do not divide into the turn: the mark breathes, and a ring
  // of light leaves it every few seconds. Three loops that never line up read as alive;
  // one loop reads as a spinner, and a spinner means the app is busy.
  const breath = useMemo(() => new Animated.Value(0), []);
  const halo = useMemo(() => new Animated.Value(0), []);
  // The gauge fills rather than jumping, so finishing a task is visible as movement.
  const filled = useMemo(() => new Animated.Value(0), []);
  const [still, setStill] = useState(false);
  const bn = language === 'bn';

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (!cancelled) setStill(enabled); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (still) return undefined;
    const loops = Animated.parallel([
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.delay(2600),
        Animated.timing(halo, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
    ]);
    loops.start();
    return () => loops.stop();
  }, [spin, breath, halo, still]);

  // The ring animates to the day's progress instead of appearing at it, so completing
  // something is felt rather than merely displayed.
  useEffect(() => {
    const target = total ? progress : 1;
    if (still) { filled.setValue(target); return undefined; }
    const move = Animated.timing(filled, {
      toValue: target, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    move.start();
    return () => move.stop();
  }, [filled, progress, total, still]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const digits = (value: number) => (bn ? String(value).replace(/[0-9]/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d) : String(value));

  return (
    <View
      style={[styles.root, { width: size, height: size }]}
      accessibilityRole="image"
      accessibilityLabel={
        total
          ? (bn ? `আজ ${digits(total)}টির মধ্যে ${digits(done)}টি শেষ` : `${bnNum(done)} of ${bnNum(total)} done today`)
          : (bn ? 'আজ এখনো কিছু পরিকল্পনা করা হয়নি' : 'Nothing planned for today yet')
      }
    >
      <Animated.View
        style={[
          styles.halo,
          {
            width: size, height: size, borderRadius: size / 2,
            opacity: halo.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.22, 0] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.5] }) }],
          },
        ]}
      />
      <Animated.View
        style={{
          transform: [
            { rotate },
            { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
          ],
        }}
      >
        <AnimatedMark
          size={size}
          // The brand's own gold, sampled from the logo file, rather than the lighter tint
          // this carried. The hero is the largest the mark ever appears, so a gold that is
          // nearly-but-not-quite right is most visible here.
          color="#F4C54F"
          trackColor="rgba(255,255,255,0.18)"
          // An empty day still shows a whole ring: a hero that reads as zero every morning
          // before you have planned anything is a reproach, not information.
          progress={filled}
        />
      </Animated.View>

      {/* No figures inside the ring. Home showed "2/4" here and again in the progress card
          a few hundred pixels below, where it sits with the streak, a real progress bar and
          a line of encouragement — the same number twice in one screenful, and this copy set
          at 11px, below the smallest size in the type scale. The arc is what a ring is for;
          the card owns the counting. Screen-reader users lose nothing: the numbers are still
          spoken from this component's accessibility label. */}
    </View>
  );
});

const AnimatedMark = Animated.createAnimatedComponent(AponMark);

const styles = StyleSheet.create({
  halo: { position: 'absolute', borderWidth: 1.2, borderColor: '#F0D48A' },
  root: { alignItems: 'center', justifyContent: 'center' },
});
