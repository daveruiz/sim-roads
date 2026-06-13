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
