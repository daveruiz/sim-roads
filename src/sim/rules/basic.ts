import { BehaviorRule } from "./types.ts";
import { freeAccel, followAccel } from "./idm.ts";

/** Accelerate toward the desired free-flow speed on open road. */
export const cruiseRule: BehaviorRule = {
  id: "cruise",
  label: "Velocidad de crucero",
  description: "Acelera hasta la velocidad deseada (límite de vía / del vehículo).",
  enabled: true,
  evaluate(ctx) {
    return freeAccel(ctx.vehicle.speed, ctx.desiredSpeed, ctx.vehicle.type);
  },
};

/** Keep a safe IDM following distance to the vehicle ahead. */
export const carFollowingRule: BehaviorRule = {
  id: "car-following",
  label: "Seguimiento (car-following)",
  description: "Mantiene una distancia de seguridad al vehículo de delante (modelo IDM).",
  enabled: true,
  evaluate(ctx) {
    if (!ctx.leader) return null;
    return followAccel(
      ctx.vehicle.speed,
      ctx.desiredSpeed,
      ctx.leader.gap,
      ctx.leader.speed,
      ctx.vehicle.type
    );
  },
};

/**
 * Last-resort collision avoidance: brake for any vehicle physically ahead in a
 * narrow forward cone, whatever lane it is on. This catches contact that the
 * structured car-following and junction rules don't (e.g. merging/crossing
 * paths converging geometrically).
 */
export const proximityRule: BehaviorRule = {
  id: "proximity",
  label: "Anticolisión de proximidad",
  description: "Frena ante cualquier vehículo físicamente delante, en cualquier carril.",
  enabled: true,
  evaluate(ctx) {
    if (!ctx.proximity) return null;
    return followAccel(
      ctx.vehicle.speed,
      ctx.desiredSpeed,
      ctx.proximity.gap,
      ctx.proximity.speed,
      ctx.vehicle.type
    );
  },
};
