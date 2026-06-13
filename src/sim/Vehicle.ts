import { Vec2 } from "../core/vec.ts";
import { nextId } from "../core/id.ts";
import { VehicleType } from "./vehicleTypes.ts";
import { PathEl } from "./path.ts";

/** A single moving vehicle following a fixed, pre-planned route to its exit. */
export class Vehicle {
  id = nextId("veh");
  /** Full planned path: route[routeIndex] is the current element. */
  route: PathEl[];
  routeIndex = 0;
  s = 0; // arc length along the current element
  speed = 0; // m/s
  accel = 0; // m/s^2 chosen by the behaviour engine this tick
  /** Set true when the vehicle reaches its destination and should be removed. */
  done = false;
  /**
   * Id of the give-way connector this vehicle has already committed to crossing,
   * so it doesn't re-evaluate (and freeze) mid-intersection. Reset on clearing.
   */
  clearedControl: string | null = null;

  constructor(public type: VehicleType, route: PathEl[]) {
    this.route = route;
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

  /** Elements ahead of the vehicle on its route (excluding current). */
  ahead(): PathEl[] {
    return this.route.slice(this.routeIndex + 1);
  }

  /** Advance the vehicle's position, rolling onto the next element as needed. */
  advance(ds: number): void {
    this.s += ds;
    while (this.s > this.current.poly.length) {
      if (this.routeIndex >= this.route.length - 1) {
        // Reached the end of the planned route: arrived at the destination.
        this.s = this.current.poly.length;
        this.done = true;
        return;
      }
      this.s -= this.current.poly.length;
      this.routeIndex++;
      // Drop already-passed elements to keep the array small on long routes.
      if (this.routeIndex > 32) {
        this.route = this.route.slice(this.routeIndex);
        this.routeIndex = 0;
      }
    }
  }
}
