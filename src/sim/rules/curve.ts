import { BehaviorRule } from "./types.ts";
import { freeAccel } from "./idm.ts";
import { isConnector, PathEl } from "../path.ts";

const LATERAL_ACCEL = 2.8; // m/s^2 comfortable cornering
const LOOKAHEAD_DIST = 28; // m — start slowing this far before a curve

/** Comfortable speed for a connector given its curvature (turn angle / length). */
function curveLimit(el: PathEl): number {
  if (!isConnector(el)) return Infinity;
  const angle = Math.abs(el.turnAngle);
  if (angle < 0.12) return Infinity; // essentially straight
  const radius = Math.max(2, el.poly.length / angle);
  return Math.sqrt(LATERAL_ACCEL * radius);
}

/**
 * Slow down for curves: finds the tightest connector within the lookahead and
 * eases toward its comfortable cornering speed before entering it.
 */
export const curveSpeedRule: BehaviorRule = {
  id: "curve-speed",
  label: "Reducir en curvas",
  description: "Adapta la velocidad al radio de las curvas y giros.",
  enabled: true,
  evaluate(ctx) {
    const veh = ctx.vehicle;
    let limit = curveLimit(veh.current);
    let traveled = veh.current.poly.length - veh.s;
    for (let i = veh.routeIndex + 1; i < veh.route.length; i++) {
      if (traveled > LOOKAHEAD_DIST) break;
      limit = Math.min(limit, curveLimit(veh.route[i]));
      traveled += veh.route[i].poly.length;
    }
    if (!isFinite(limit) || limit >= ctx.desiredSpeed) return null;
    return freeAccel(veh.speed, limit, veh.type);
  },
};
