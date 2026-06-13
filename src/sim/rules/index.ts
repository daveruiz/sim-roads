import { BehaviorRule, RuleContext } from "./types.ts";
import { cruiseRule, carFollowingRule } from "./basic.ts";
import { giveWayRule } from "./giveWay.ts";
import { curveSpeedRule } from "./curve.ts";

export type { BehaviorRule, RuleContext } from "./types.ts";

/**
 * The behaviour ruleset. This is the single, extensible array the whole engine
 * is built around: to add a behaviour, write a rule and push it here. The
 * engine evaluates every enabled rule and applies the most cautious (minimum)
 * acceleration, clamped to the vehicle's comfort limits.
 */
export const RULES: BehaviorRule[] = [
  cruiseRule,
  carFollowingRule,
  giveWayRule,
  curveSpeedRule,
];

/** Combine all enabled rules into a single acceleration command. */
export function decideAcceleration(ctx: RuleContext): number {
  let accel = ctx.vehicle.type.maxAccel;
  for (const rule of RULES) {
    if (!rule.enabled) continue;
    const a = rule.evaluate(ctx);
    if (a !== null && a < accel) accel = a;
  }
  // Clamp to comfort envelope.
  return Math.max(-ctx.vehicle.type.maxDecel, Math.min(ctx.vehicle.type.maxAccel, accel));
}
