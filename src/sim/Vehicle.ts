import { Vec2, add, scale, sub, dist, normalize, lerp } from "../core/vec.ts";
import { nextId } from "../core/id.ts";
import { Lane } from "../network/types.ts";
import { VehicleType } from "./vehicleTypes.ts";
import { PathEl } from "./path.ts";

/** Lateral lane-change speed, in offset fraction per second (full change ≈ 2 s). */
const LANE_CHANGE_RATE = 0.5;

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

  /* ---------------------------- lane changes ---------------------------- */
  /**
   * Discretionary lane changes are modelled as a lateral offset from the
   * planned (logical) lane, so routing and occupancy stay on a single lane while
   * the vehicle physically slides toward an adjacent one to overtake and back.
   */
  offsetLane: Lane | null = null; // adjacent lane being straddled (null = centred)
  offset = 0; // 0 = on plan lane, 1 = fully on offsetLane
  offsetTarget = 0; // value `offset` is animating toward
  lateralVel = 0; // d(offset)/dt this tick (signed), for heading/yaw
  /** Whether this driver respects lane discipline (keep right, return promptly). */
  disciplined = true;

  constructor(public type: VehicleType, route: PathEl[]) {
    this.route = route;
  }

  get current(): PathEl {
    return this.route[this.routeIndex];
  }

  /** Point on the offset lane corresponding to the current longitudinal s. */
  private offsetPoint(): Vec2 {
    const lane = this.offsetLane!;
    const total = this.current.poly.length;
    const f = total > 0 ? Math.min(this.s / total, 1) : 0;
    return lane.poly.posAt(f * lane.poly.length);
  }

  pos(): Vec2 {
    const base = this.current.poly.posAt(this.s);
    if (!this.offsetLane || this.offset <= 0) return base;
    const off = this.offsetPoint();
    const t = this.offset * this.offset * (3 - 2 * this.offset); // smoothstep
    return lerp(base, off, t);
  }

  dir(): Vec2 {
    const base = this.current.poly.dirAt(this.s);
    if (!this.offsetLane || this.lateralVel === 0) return base;
    // Heading follows the actual velocity: forward along the lane plus the
    // lateral component of the ongoing change, so the car yaws into the move.
    const planP = this.current.poly.posAt(this.s);
    const latDir = normalize(sub(this.offsetPoint(), planP));
    const gap = dist(planP, this.offsetPoint()) || 3.5;
    const world = add(scale(base, Math.max(this.speed, 2)), scale(latDir, this.lateralVel * gap));
    return normalize(world);
  }

  /** Begin sliding toward an adjacent lane (idempotent if already heading there). */
  startChange(target: Lane): void {
    this.offsetLane = target;
    this.offsetTarget = 1;
  }

  /** Begin returning to the plan lane (keeps the offset lane until centred). */
  returnToLane(): void {
    this.offsetTarget = 0;
  }

  /** Advance the lateral offset toward its target; clears it once centred. */
  advanceLateral(dt: number): void {
    if (!this.offsetLane) {
      this.lateralVel = 0;
      return;
    }
    const prev = this.offset;
    const step = LANE_CHANGE_RATE * dt;
    if (this.offset < this.offsetTarget) this.offset = Math.min(this.offsetTarget, this.offset + step);
    else if (this.offset > this.offsetTarget) this.offset = Math.max(this.offsetTarget, this.offset - step);
    this.lateralVel = (this.offset - prev) / Math.max(dt, 1e-4);
    if (this.offset <= 0 && this.offsetTarget <= 0) {
      this.offsetLane = null;
      this.offset = 0;
      this.lateralVel = 0;
    }
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
      // A lane change cannot span a junction: drop any straddle on element change.
      this.offsetLane = null;
      this.offset = 0;
      this.offsetTarget = 0;
      this.lateralVel = 0;
      // Drop already-passed elements to keep the array small on long routes.
      if (this.routeIndex > 32) {
        this.route = this.route.slice(this.routeIndex);
        this.routeIndex = 0;
      }
    }
  }
}
