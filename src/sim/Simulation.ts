import { RoadNetwork } from "../network/RoadNetwork.ts";
import { Connector, Lane } from "../network/types.ts";
import { Vehicle } from "./Vehicle.ts";
import { pickVehicleType, VEHICLE_TYPES } from "./vehicleTypes.ts";
import { planRoute } from "./Router.ts";
import { decideAcceleration } from "./rules/index.ts";
import { RuleContext, ControlAhead, LeaderInfo } from "./rules/types.ts";
import { PathEl, isLane } from "./path.ts";

const LEADER_LOOKAHEAD = 140; // m
const CONTROL_LOOKAHEAD = 70; // m
const EXIT_CLEARANCE = 6; // m of room required on the destination lane to enter

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
      control: this.findControl(v),
      isCrossingClear: (c) => this.crossingClear(c),
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
        const gap = best.s - best.type.length - v.s;
        return { gap: Math.max(gap, 0), speed: best.speed };
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
        const gap = distToEl + (first.s - first.type.length);
        return { gap: Math.max(gap, 0), speed: first.speed };
      }
      distToEl += el.poly.length;
    }
    return null;
  }

  /** Next give-way connector ahead and the distance to its stop line. */
  private findControl(v: Vehicle): ControlAhead | null {
    let distToStart = v.current.poly.length - v.s; // start of the next element
    for (let i = v.routeIndex + 1; i < v.route.length; i++) {
      if (distToStart > CONTROL_LOOKAHEAD) break;
      const el = v.route[i];
      if (!isLane(el) && (el as Connector).control !== "free") {
        return { connector: el as Connector, distance: Math.max(distToStart, 0) };
      }
      distToStart += el.poly.length;
    }
    return null;
  }

  /**
   * Gap acceptance for a yielding connector: inspect every conflicting
   * connector (and its feeding lane) for priority vehicles approaching the
   * shared crossing point.
   */
  private crossingClear(conn: Connector): { minTimeGap: number; blocked: boolean } {
    let minTimeGap = Infinity;
    let blocked = false;

    for (const conflict of conn.conflicts) {
      const other = conflict.other;
      const priority = other.control === "free";

      // Vehicles currently on the conflicting connector.
      const onOther = this.occ.get(other.id);
      if (onOther) {
        for (const o of onOther) {
          const front = o.s;
          const rear = o.s - o.type.length;
          if (rear <= conflict.sOther + 0.5 && front >= conflict.sOther - 0.5) {
            blocked = true; // body is on the crossing point right now
          }
          if (priority && front < conflict.sOther) {
            const t = (conflict.sOther - front) / Math.max(o.speed, 0.5);
            if (t < minTimeGap) minTimeGap = t;
          }
        }
      }

      // Priority vehicles still on the feeding lane that will take `other`.
      if (priority) {
        const lane = other.from;
        const onLane = this.occ.get(lane.id);
        if (onLane) {
          for (const o of onLane) {
            const next = o.route[o.routeIndex + 1];
            if (next !== other) continue;
            const d = lane.poly.length - o.s + conflict.sOther;
            const t = d / Math.max(o.speed, 0.5);
            if (t < minTimeGap) minTimeGap = t;
          }
        }
      }
    }

    // Entry metering ("don't block the box"): never enter a junction unless
    // there is physical room on the destination lane just past the merge.
    // Without this, a stopped queue downstream registers an "infinite" time
    // gap and vehicles pack the junction into a closed-loop deadlock.
    const dest = this.occ.get(conn.to.id);
    if (dest) {
      for (const o of dest) {
        if (o.s - o.type.length < EXIT_CLEARANCE) {
          blocked = true;
          break;
        }
      }
    }

    return { minTimeGap, blocked };
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
