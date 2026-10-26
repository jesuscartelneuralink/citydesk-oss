// Stick magnitude to a person's pace. Pure. Dead-zone under 0.08 stands still.
export type GaitSpeed = { mode: "stand" | "walk" | "jog"; metresPerSecond: number };

const STAND_BELOW = 0.08;
const JOG_FROM = 0.85;
const WALK_MPS = 1.4;
const JOG_MPS = 3.2;

/** Clamp a finite positive stick into 0..1, then pick stand, walk, or jog. */
export function gaitSpeed(stick: number): GaitSpeed {
  if (!Number.isFinite(stick)) return { mode: "stand", metresPerSecond: 0 };
  const mag = stick > 0 ? Math.min(1, Math.max(0, stick)) : stick;
  if (mag < STAND_BELOW) return { mode: "stand", metresPerSecond: 0 };
  if (mag < JOG_FROM) return { mode: "walk", metresPerSecond: WALK_MPS };
  return { mode: "jog", metresPerSecond: JOG_MPS };
}
