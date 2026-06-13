import { Vehicle } from "../Vehicle.ts";
import { Connector } from "../../network/types.ts";

/** Information about the vehicle directly ahead along the planned route. */
export interface LeaderInfo {
  gap: number; // bumper-to-bumper distance (m)
  speed: number; // leader speed (m/s)
}

/** The next give-way controlled connector on the route and the distance to it. */
export interface ControlAhead {
  connector: Connector;
  distance: number; // distance from vehicle front to the stop line (m)
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
  /** Next give-way connector ahead, or null. */
  control: ControlAhead | null;
  /**
   * For a give-way connector, whether it is safe to proceed: returns the
   * smallest time-gap (s) of any conflicting priority vehicle reaching a shared
   * crossing point, and whether a crossing point is currently blocked.
   */
  isCrossingClear(c: Connector): { minTimeGap: number; blocked: boolean };
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
