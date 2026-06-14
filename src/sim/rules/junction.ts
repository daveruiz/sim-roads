import { BehaviorRule } from "./types.ts";
import { followAccel } from "./idm.ts";

/**
 * Cooperative right-of-way and collision avoidance at junctions. The simulation
 * resolves, for every connector with conflicts (crossings and merges), whether
 * the vehicle must give way — by sign priority, and on equal priority by who is
 * closer to the conflict point — and never lets a vehicle enter an occupied
 * conflict point. The result is a stop distance; this rule brakes to it.
 */
export const junctionRule: BehaviorRule = {
  id: "junction",
  label: "Prioridad y anticolisión en cruces",
  description:
    "Cede el paso y evita colisiones en intersecciones, fusiones y rotondas (cooperativo).",
  enabled: true,
  evaluate(ctx) {
    if (ctx.junctionStop == null) return null;
    return followAccel(
      ctx.vehicle.speed,
      ctx.desiredSpeed,
      Math.max(ctx.junctionStop, 0.05),
      0,
      ctx.vehicle.type
    );
  },
};
