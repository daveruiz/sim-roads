import { Vehicle } from "../Vehicle.ts";

/** Information about the vehicle directly ahead along the planned route. */
export interface LeaderInfo {
  gap: number; // bumper-to-bumper distance (m)
  speed: number; // leader speed (m/s)
}

/**
 * Everything a behaviour rule may need this tick. The simulation builds one of
 * these per vehicle; the queries are closures over the spatial state so rules
 * stay free of bookkeeping.
 */
export interface RuleContext {
  vehicle: Vehicle;
  dt: number;
  /** Desired free-flow speed for this vehicle here (min of type & road). */
  desiredSpeed: number;
  /** Nearest leader ahead, or null on open road. */
  leader: LeaderInfo | null;
  /**
   * Nearest vehicle physically ahead within a narrow forward cone, regardless
   * of lane/route — a last-resort collision-avoidance obstacle.
   */
  proximity: LeaderInfo | null;
  /**
   * Distance (m) at which the vehicle must come to a stop before a junction it
   * has to give way to (cooperative collision avoidance), or null if clear.
   */
  junctionStop: number | null;
}

/**
 * A behaviour rule. `evaluate` returns a desired acceleration (m/s^2) or null
 * when the rule does not apply this tick. The engine applies the minimum
 * (most cautious) acceleration across all enabled rules.
 */
export interface BehaviorRule {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  evaluate(ctx: RuleContext): number | null;
}
