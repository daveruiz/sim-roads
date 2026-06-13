import { Vec2 } from "../core/vec.ts";
import { nextId } from "../core/id.ts";
import { Lane, Connector } from "../network/types.ts";
import { VehicleType } from "./vehicleTypes.ts";
import { PathEl, isLane } from "./path.ts";

const LOOKAHEAD_ELEMENTS = 6;

/** A single moving vehicle with a forward-extending planned route. */
export class Vehicle {
  id = nextId("veh");
  /** Planned path: route[routeIndex] is the current element. */
  route: PathEl[] = [];
  routeIndex = 0;
  s = 0; // arc length along the current element
  speed = 0; // m/s
  accel = 0; // m/s^2 chosen by the behaviour engine this tick
  /** Set true when the vehicle reaches a sink and should be removed. */
  done = false;
  /**
   * Id of the give-way connector this vehicle has already committed to crossing,
   * so it doesn't re-evaluate (and freeze) mid-intersection. Reset on clearing.
   */
  clearedControl: string | null = null;

  constructor(public type: VehicleType, startLane: Lane) {
    this.route = [startLane];
    this.extendRoute();
  }

  get current(): PathEl {
    return this.route[this.routeIndex];
  }

  pos(): Vec2 {
    return this.current.poly.posAt(this.s);
  }

  dir(): Vec2 {
    return this.current.poly.dirAt(this.s);
  }

  /** Elements ahead of the vehicle on its current route (excluding current). */
  ahead(): PathEl[] {
    return this.route.slice(this.routeIndex + 1);
  }

  /**
   * Ensure the route extends a few elements past the current one, choosing
   * connectors via the supplied chooser (defaults to a turn-weighted random).
   */
  extendRoute(chooser: RouteChooser = weightedTurnChooser): void {
    while (this.route.length - this.routeIndex < LOOKAHEAD_ELEMENTS) {
      const last = this.route[this.route.length - 1];
      if (isLane(last)) {
        const conn = chooser(last);
        if (!conn) break; // sink: route ends here
        this.route.push(conn);
      } else {
        this.route.push((last as Connector).to);
      }
    }
  }

  /** Advance the vehicle's position, rolling onto the next element as needed. */
  advance(ds: number, chooser: RouteChooser = weightedTurnChooser): void {
    this.s += ds;
    while (this.s > this.current.poly.length) {
      if (this.routeIndex >= this.route.length - 1) {
        // Reached the planned end; try to extend, else finish.
        this.extendRoute(chooser);
        if (this.routeIndex >= this.route.length - 1) {
          this.s = this.current.poly.length;
          this.done = true;
          return;
        }
      }
      this.s -= this.current.poly.length;
      this.routeIndex++;
      this.extendRoute(chooser);
      // Drop already-passed elements occasionally to keep the array small.
      if (this.routeIndex > 32) {
        this.route = this.route.slice(this.routeIndex);
        this.routeIndex = 0;
      }
    }
  }
}

export type RouteChooser = (lane: Lane) => Connector | null;

/**
 * Default route choice: pick a connector at random, biased toward going
 * straight (small turn angle) over sharp turns, so traffic flows naturally.
 */
export function weightedTurnChooser(lane: Lane): Connector | null {
  const opts = lane.outgoing;
  if (opts.length === 0) return null;
  if (opts.length === 1) return opts[0];
  const weights = opts.map((c) => Math.exp(-Math.abs(c.turnAngle) * 1.2));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < opts.length; i++) {
    r -= weights[i];
    if (r <= 0) return opts[i];
  }
  return opts[opts.length - 1];
}
