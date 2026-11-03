// The আপন mark.
//
// A gold আ inside a ring that is deliberately left open at the upper right. A closed
// circle reads as a lock; an open one reads as an arm around something, and this app
// holds a person's whole life rather than confining it — so the gap is the design, not an
// accident of drawing.
//
// The letter is set from the app's own Bengali face rather than drawn from paths. An
// earlier attempt built the আ out of lines and arcs, and it did not read as the letter at
// all — a logo whose letterform is subtly wrong is worse than a plain one. The designed
// part here is the ring; the letter is simply correct.
//
// The ring doubles as a gauge. `progress` below 1 draws only part of the arc, which is
// what lets Home show how much of today is done using the same mark instead of adding a
// second decorative thing to the screen.

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { AppText as Text } from './AppText';

export interface AponMarkProps {
  size?: number;
  /** The mark's one colour. It never uses two. */
  color?: string;
  /** The unfilled part of the ring, for the gauge. Defaults to a faint version of `color`. */
  trackColor?: string;
  /** How much of the ring is drawn, 0–1. A whole mark is 1. */
  progress?: number;
}

// Geometry, shared with the raster assets so icon and screen cannot drift apart.
const VIEW = 100;
const RADIUS = 38;
const STROKE = 5.4;
const GAP_DEGREES = 34;
/** Where the opening sits: upper right, in the direction the matra runs. */
const GAP_CENTRE = -62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The ball terminal at each end of the opening — heavier than the stroke, as in the logo. */
const DOT = STROKE * 0.78;
const SWEEP = (360 - GAP_DEGREES) / 360;

export const AponMark = memo(function AponMark({
  size = 96,
  // The brand's gold, sampled from the logo file rather than approximated.
  color = '#F4C54F',
  trackColor,
  progress = 1,
}: AponMarkProps) {
  const shown = Math.max(0, Math.min(1, progress)) * SWEEP;

  return (
    <View style={[styles.root, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        {/* Rotated so the dash starts at the gap's trailing edge and runs clockwise. */}
        <G rotation={GAP_CENTRE + GAP_DEGREES / 2} origin={`${VIEW / 2}, ${VIEW / 2}`}>
          {trackColor ? (
            <Circle
              cx={VIEW / 2}
              cy={VIEW / 2}
              r={RADIUS}
              stroke={trackColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRCUMFERENCE * SWEEP} ${CIRCUMFERENCE}`}
            />
          ) : null}
          <Circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE * shown} ${CIRCUMFERENCE}`}
          />

          {/* The two terminals at the opening.
              They are not decoration: in the brand mark the ring ends in a ball at each
              side of the gap, a little heavier than the stroke, and without them the
              mark on screen was a plain broken circle that did not match the icon on the
              launcher. The first sits at the fixed start of the arc; the second rides the
              drawn end, so at a whole mark it lands exactly on the logo's own position
              and, when the ring is used as a gauge, it reads as the head of the sweep. */}
          <Circle cx={VIEW / 2 + RADIUS} cy={VIEW / 2} r={DOT} fill={color} />
          <Circle
            cx={VIEW / 2 + RADIUS * Math.cos(shown * 2 * Math.PI)}
            cy={VIEW / 2 + RADIUS * Math.sin(shown * 2 * Math.PI)}
            r={DOT}
            fill={color}
          />
        </G>
      </Svg>

      <View style={styles.letterSlot} pointerEvents="none">
        <Text
          allowFontScaling={false}
          // Sized against the ring's inner diameter, not the whole box. The letter has to clear
          // the stroke on both sides with air to spare — at 0.4 the matra broke through the
          // top, at 0.32 the আ-কার still grazed it, and a mark whose parts touch reads as a
          // mistake rather than a design.
          style={{ color, fontSize: size * 0.27, lineHeight: size * 0.38, fontWeight: '700' }}
        >
          আ
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  letterSlot: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});

/** The ring's geometry, for anything animating the same arc. */
export const APON_RING = { dot: DOT, radius: RADIUS, circumference: CIRCUMFERENCE, sweep: SWEEP, stroke: STROKE, gapCentre: GAP_CENTRE, gapDegrees: GAP_DEGREES, view: VIEW };
