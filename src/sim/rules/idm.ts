import { VehicleType } from "../vehicleTypes.ts";

/** Tunable Intelligent Driver Model parameters (global defaults). */
export const IDM = {
  timeHeadway: 1.4, // s — desired time gap to leader
  minGap: 2.0, // s0 — standstill distance (m)
  delta: 4, // free acceleration exponent
};

/**
 * IDM free-road term: how hard to accelerate toward the desired speed on an
 * empty road.
 */
export function freeAccel(speed: number, desired: number, type: VehicleType): number {
  if (desired <= 0) return -type.maxDecel;
  return type.maxAccel * (1 - Math.pow(speed / desired, IDM.delta));
}

/**
 * IDM interaction term: acceleration when following a leader (or approaching a
 * fixed obstacle, by passing leaderSpeed = 0). `gap` is bumper-to-bumper.
 */
export function followAccel(
  speed: number,
  desired: number,
  gap: number,
  leaderSpeed: number,
  type: VehicleType
): number {
  const a = type.maxAccel;
  const b = type.maxDecel;
  const dv = speed - leaderSpeed; // closing speed
  const sStar =
    IDM.minGap +
    Math.max(0, speed * IDM.timeHeadway + (speed * dv) / (2 * Math.sqrt(a * b)));
  const safeGap = Math.max(gap, 0.1);
  const interaction = a * Math.pow(sStar / safeGap, 2);
  return freeAccel(speed, desired, type) - interaction;
}
