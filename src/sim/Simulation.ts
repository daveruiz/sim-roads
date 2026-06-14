import { RoadNetwork } from "../network/RoadNetwork.ts";
import { Connector, Lane, Conflict, Control } from "../network/types.ts";
import { Vehicle } from "./Vehicle.ts";
import { pickVehicleType, VEHICLE_TYPES } from "./vehicleTypes.ts";
import { planRoute } from "./Router.ts";
import { decideAcceleration } from "./rules/index.ts";
import { RuleContext, LeaderInfo } from "./rules/types.ts";
import { PathEl, isLane, isConnector } from "./path.ts";

const LEADER_LOOKAHEAD = 140; // m
const JUNCTION_LOOKAHEAD = 60; // m — start considering a junction this far ahead
const EXIT_CLEARANCE = 6; // m of room required on the destination lane to enter
const REQUIRED_GAP = 3.2; // s — minimum acceptable time gap to a priority vehicle
const STOP_SPEED = 0.5; // m/s — counts as "stopped" at a STOP line
const STOP_ZONE = 3.0; // m — distance within which a STOP is registered
const GRID_CELL = 12; // m — spatial hash cell size for proximity queries
const HARD_GAP = 0.5; // m — minimum bumper gap enforced after integration

/** Sign priority ranking (higher = more right of way). */
function priority(c: Control): number {
  return c === "free" ? 2 : c === "yield" ? 1 : 0;
}

export interface SimConfig {
  /** Target vehicles spawned per second across all sources. */
  spawnRate: number;
  /** Vehicle type ids allowed to spawn. */
  enabledTypes: Set<string>;
}

export interface SimStats {
  vehicles: number;
  avgSpeed: number; // m/s
  spawned: number;
  arrived: number;
}

/** The running traffic simulation over a road network's runtime graph. */
export class Simulation {
  vehicles: Vehicle[] = [];
  config: SimConfig = {
    spawnRate: 0.8,
    enabledTypes: new Set(VEHICLE_TYPES.map((t) => t.id)),
  };
  stats: SimStats = { vehicles: 0, avgSpeed: 0, spawned: 0, arrived: 0 };

  private spawnAccumulator = 0;
  private occ = new Map<string, Vehicle[]>(); // element id -> vehicles sorted by s
  private grid = new Map<string, Vehicle[]>(); // spatial hash for proximity queries

  constructor(private net: RoadNetwork) {}

  reset(): void {
    this.vehicles = [];
    this.spawnAccumulator = 0;
    this.occ.clear();
    this.stats = { vehicles: 0, avgSpeed: 0, spawned: 0, arrived: 0 };
  }

  step(dt: number): void {
    this.spawn(dt);
    this.buildOccupancy();
    this.buildGrid();

    // Phase 1: decide acceleration for every vehicle from a frozen snapshot.
    for (const v of this.vehicles) {
      v.accel = decideAcceleration(this.buildContext(v, dt));
    }

    // Phase 2: integrate motion.
    for (const v of this.vehicles) {
      const desired = this.desiredSpeed(v);
      v.speed = Math.max(0, Math.min(desired + 2, v.speed + v.accel * dt));
      v.advance(v.speed * dt);
    }

    // Phase 3: hard separation safeguard — never let a vehicle overlap the one
    // ahead on the same element (handles stop-and-go overshoot, long vehicles
    // and merges that converge onto a single lane).
    this.enforceSeparation();

    // Remove finished vehicles.
    const before = this.vehicles.length;
    this.vehicles = this.vehicles.filter((v) => !v.done);
    this.stats.arrived += before - this.vehicles.length;

    this.updateStats();
  }

  /* --------------------------- spawning --------------------------- */

  private spawn(dt: number): void {
    const sources = this.net.graph.sources;
    if (sources.length === 0) return;
    this.spawnAccumulator += this.config.spawnRate * dt;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.trySpawnOne(sources);
    }
  }

  private trySpawnOne(sources: Lane[]): void {
    const sinks = this.net.graph.sinks;
    // Try a few random sources until one has room and a reachable destination.
    for (let attempt = 0; attempt < 6; attempt++) {
      const lane = sources[(Math.random() * sources.length) | 0];
      const type = pickVehicleType(this.config.enabledTypes, Math.random);
      const clearance = type.length + 6;
      const onLane = this.occ.get(lane.id);
      const blocked = onLane?.some((v) => v.s < clearance);
      if (blocked) continue;
      const route = planRoute(lane, sinks);
      if (!route) continue; // no exit reachable from this source
      const v = new Vehicle(type, route);
      v.speed = Math.min(this.desiredSpeed(v), 8);
      this.vehicles.push(v);
      this.stats.spawned += 1;
      return;
    }
  }

  /* ------------------------- spatial state ------------------------ */

  private buildOccupancy(): void {
    this.occ.clear();
    for (const v of this.vehicles) {
      const id = v.current.id;
      const arr = this.occ.get(id);
      if (arr) arr.push(v);
      else this.occ.set(id, [v]);
    }
    for (const arr of this.occ.values()) arr.sort((a, b) => a.s - b.s);
  }

  /**
   * Push back any vehicle that ended a step overlapping the one ahead along its
   * route (same element OR across a junction — a long vehicle can span several
   * elements). Uses the route-aware leader search so it also resolves merges and
   * trucks straddling small junctions. A couple of relaxation passes settle
   * queues without cascading overlaps.
   */
  private enforceSeparation(): void {
    for (let iter = 0; iter < 2; iter++) {
      this.buildOccupancy(); // refresh after the integration / previous pass
      let changed = false;
      for (const v of this.vehicles) {
        const lead = this.findLeader(v);
        if (lead && lead.gap < HARD_GAP) {
          v.s = Math.max(0, v.s - (HARD_GAP - lead.gap));
          if (v.speed > lead.speed) v.speed = lead.speed;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  private buildGrid(): void {
    this.grid.clear();
    for (const v of this.vehicles) {
      const p = v.pos();
      const key = `${Math.floor(p.x / GRID_CELL)},${Math.floor(p.y / GRID_CELL)}`;
      const arr = this.grid.get(key);
      if (arr) arr.push(v);
      else this.grid.set(key, [v]);
    }
  }

  /**
   * Nearest vehicle physically ahead of `v` within a narrow forward cone
   * (any lane). Returns a leader-like obstacle for last-resort braking.
   */
  private proximityObstacle(v: Vehicle): LeaderInfo | null {
    const p = v.pos();
    const dir = v.dir();
    const range = Math.max(8, Math.min(20, v.speed * 1.6));
    let bestFwd = Infinity;
    let result: LeaderInfo | null = null;
    const cx = Math.floor(p.x / GRID_CELL);
    const cy = Math.floor(p.y / GRID_CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const cell = this.grid.get(`${gx},${gy}`);
        if (!cell) continue;
        for (const w of cell) {
          if (w === v) continue;
          // Same-direction traffic only (rear-ends, merges). Crossing/oncoming
          // is the junction rule's job; braking for it here gridlocks junctions.
          const wd = w.dir();
          const align = wd.x * dir.x + wd.y * dir.y;
          if (align < 0.3) continue;
          const wp = w.pos();
          const rx = wp.x - p.x;
          const ry = wp.y - p.y;
          const fwd = rx * dir.x + ry * dir.y;
          if (fwd <= 0 || fwd > range) continue; // behind or out of range
          const lat = -rx * dir.y + ry * dir.x;
          const halfWidth = (v.type.width + w.type.width) / 2 + 0.3;
          if (Math.abs(lat) > halfWidth) continue; // not in my path
          if (fwd < bestFwd) {
            bestFwd = fwd;
            const gap = fwd - (v.type.length + w.type.length) / 2;
            result = { gap: Math.max(gap, 0), speed: w.speed * align };
          }
        }
      }
    }
    return result;
  }

  private desiredSpeed(v: Vehicle): number {
    const cur = v.current;
    const limit = isLane(cur)
      ? cur.speedLimit
      : Math.min((cur as Connector).from.speedLimit, (cur as Connector).to.speedLimit);
    return Math.min(v.type.maxSpeed, limit);
  }

  /* ----------------------- context building ----------------------- */

  private buildContext(v: Vehicle, dt: number): RuleContext {
    return {
      vehicle: v,
      dt,
      desiredSpeed: this.desiredSpeed(v),
      leader: this.findLeader(v),
      proximity: this.proximityObstacle(v),
      junctionStop: this.junctionConstraint(v),
    };
  }

  /** Nearest vehicle ahead along the route, gap measured bumper-to-bumper. */
  private findLeader(v: Vehicle): LeaderInfo | null {
    // Same element first.
    const same = this.occ.get(v.current.id);
    if (same) {
      let best: Vehicle | null = null;
      for (const o of same) {
        if (o === v) continue;
        if (o.s > v.s && (!best || o.s < best.s)) best = o;
      }
      if (best) {
        // Raw (possibly negative) gap so the separation safeguard can measure
        // penetration; followAccel clamps internally for the behaviour rules.
        return { gap: best.s - best.type.length - v.s, speed: best.speed };
      }
    }
    // Following elements.
    let distToEl = v.current.poly.length - v.s;
    for (let i = v.routeIndex + 1; i < v.route.length; i++) {
      if (distToEl > LEADER_LOOKAHEAD) break;
      const el = v.route[i];
      const here = this.occ.get(el.id);
      if (here && here.length) {
        const first = here[0]; // smallest s
        return { gap: distToEl + (first.s - first.type.length), speed: first.speed };
      }
      distToEl += el.poly.length;
    }
    return null;
  }

  /**
   * Cooperative junction control. While approaching a connector, decide whether
   * the vehicle must stop at its entrance — because of a STOP, a conflicting
   * vehicle with right of way, an occupied conflict point, or no room past a
   * merge. Returns the stop distance, or null if clear to proceed.
   */
  private junctionConstraint(v: Vehicle): number | null {
    // Once on a connector the vehicle is committed; rely on car-following and
    // occupancy from here (it cannot stop inside the junction).
    if (isConnector(v.current)) {
      v.clearedControl = null;
      return null;
    }
    const next = v.route[v.routeIndex + 1];
    if (!next || !isConnector(next)) {
      v.clearedControl = null;
      return null;
    }
    const conn = next as Connector;
    const d0 = v.current.poly.length - v.s; // distance to the connector entrance
    if (d0 > JUNCTION_LOOKAHEAD) return null;

    let mustStop = false;

    // STOP sign: require a full halt at the line before proceeding.
    if (conn.control === "stop" && v.clearedControl !== conn.id) {
      if (v.speed < STOP_SPEED && d0 < STOP_ZONE) v.clearedControl = conn.id;
      else mustStop = true;
    }

    // Give way to conflicting traffic that has right of way.
    if (!mustStop) {
      for (const conflict of conn.conflicts) {
        if (this.mustYieldAt(v, conn, conflict, d0)) {
          mustStop = true;
          break;
        }
      }
    }

    // Don't block the box: require physical room on the destination lane.
    if (!mustStop && !this.exitHasRoom(conn)) mustStop = true;

    if (mustStop) return Math.max(d0, 0);
    if (conn.control !== "stop") v.clearedControl = conn.id;
    return null;
  }

  /** Whether `v` must give way at one conflict of the connector it is entering. */
  private mustYieldAt(v: Vehicle, conn: Connector, conflict: Conflict, d0: number): boolean {
    const other = conflict.other;
    const dV = d0 + conflict.sSelf; // v's distance to the conflict point
    const tV = dV / Math.max(v.speed, 1.0); // v's (proxy) arrival time
    for (const w of this.competitors(other)) {
      if (w === v) continue;
      // Junction mutual exclusion: if a vehicle is already committed on the
      // conflicting connector and hasn't passed the shared point yet, wait —
      // this is what actually prevents two crossing paths being used at once.
      if (w.current === other && w.s - w.type.length < conflict.sOther + 0.5) return true;
      // Never enter an occupied conflict point, whoever has priority.
      if (this.occupiesConflict(w, other, conflict.sOther)) return true;
      if (!this.hasRightOfWay(w, other, v, conn, d0)) continue;
      const dW = this.distToConflict(w, other, conflict.sOther);
      if (dW <= 0) continue; // already past the conflict point
      // Yield if the priority vehicle reaches the conflict point before this one
      // can clear it (relative arrival, not just an absolute gap). This stops
      // two fast vehicles both entering when each is still far away.
      const tW = dW / Math.max(w.speed, 1.0);
      if (tW < tV + REQUIRED_GAP) return true;
    }
    return false;
  }

  /**
   * Does `w` (on conflicting path `other`) have priority over `v`? Higher sign
   * priority wins; on a tie, a vehicle already in the junction wins, otherwise
   * the one closer to *entering* its connector goes first. Using each vehicle's
   * own entrance distance gives a single total order across all approaches of a
   * node (stable id tie-break) — so right-of-way can never form a deadlock cycle.
   */
  private hasRightOfWay(
    w: Vehicle,
    other: Connector,
    v: Vehicle,
    conn: Connector,
    d0V: number
  ): boolean {
    const po = priority(other.control);
    const pc = priority(conn.control);
    if (po !== pc) return po > pc;
    if (w.current === other) return true; // already committed in the junction
    const d0W = w.current === other.from ? other.from.poly.length - w.s : Infinity;
    if (Math.abs(d0W - d0V) > 0.2) return d0W < d0V;
    return w.id < v.id;
  }

  /** Vehicles approaching the conflict on `other` or on the lane feeding it. */
  private *competitors(other: Connector): Generator<Vehicle> {
    const onOther = this.occ.get(other.id);
    if (onOther) for (const w of onOther) yield w;
    const feed = this.occ.get(other.from.id);
    if (feed) {
      for (const w of feed) {
        if (w.route[w.routeIndex + 1] === other) yield w;
      }
    }
  }

  /** Distance from `w` to the conflict point at arc length `sOther` on `other`. */
  private distToConflict(w: Vehicle, other: Connector, sOther: number): number {
    if (w.current === other) return sOther - w.s;
    if (w.current === other.from) return other.from.poly.length - w.s + sOther;
    return Infinity;
  }

  private occupiesConflict(w: Vehicle, other: Connector, sOther: number): boolean {
    if (w.current !== other) return false;
    return w.s - w.type.length <= sOther + 0.5 && w.s >= sOther - 0.5;
  }

  /** True if the connector's destination lane has room just past the merge. */
  private exitHasRoom(conn: Connector): boolean {
    const dest = this.occ.get(conn.to.id);
    if (!dest) return true;
    for (const o of dest) {
      if (o.s - o.type.length < EXIT_CLEARANCE) return false;
    }
    return true;
  }

  private updateStats(): void {
    let sum = 0;
    for (const v of this.vehicles) sum += v.speed;
    this.stats.vehicles = this.vehicles.length;
    this.stats.avgSpeed = this.vehicles.length ? sum / this.vehicles.length : 0;
  }
}

// Re-export for convenience.
export type { PathEl };
