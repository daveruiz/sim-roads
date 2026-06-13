import { Lane, Connector } from "../network/types.ts";
import { PathEl } from "./path.ts";

/**
 * Destination-based routing. A vehicle is given a destination when it spawns and
 * follows the shortest-time path to it, like a GPS — instead of choosing turns
 * at random. Paths are computed with Dijkstra over the lane graph (edges are the
 * connectors joining lanes), weighted by estimated travel time.
 */

function laneTime(lane: Lane): number {
  return lane.poly.length / Math.max(lane.speedLimit, 1);
}

function connTime(c: Connector): number {
  const limit = Math.min(c.from.speedLimit, c.to.speedLimit);
  return c.poly.length / Math.max(limit, 1);
}

/**
 * Plan a route from `start` to a randomly chosen reachable sink (exit).
 * Returns the interleaved [lane, connector, lane, …] path, or null when no exit
 * is reachable from the start lane.
 */
export function planRoute(
  start: Lane,
  sinks: Set<string>,
  rng: () => number = Math.random
): PathEl[] | null {
  const distTo = new Map<string, number>(); // cost to the END of each lane
  const prev = new Map<string, { conn: Connector; from: Lane }>();
  const laneById = new Map<string, Lane>([[start.id, start]]);

  distTo.set(start.id, laneTime(start));
  const heap = new MinHeap<Lane>();
  heap.push(start, distTo.get(start.id)!);

  while (!heap.isEmpty()) {
    const { item: lane, key } = heap.pop();
    if (key > (distTo.get(lane.id) ?? Infinity)) continue; // stale entry
    for (const conn of lane.outgoing) {
      const next = conn.to;
      laneById.set(next.id, next);
      const cand = key + connTime(conn) + laneTime(next);
      if (cand < (distTo.get(next.id) ?? Infinity)) {
        distTo.set(next.id, cand);
        prev.set(next.id, { conn, from: lane });
        heap.push(next, cand);
      }
    }
  }

  // Reachable exits, excluding the start lane itself.
  const reachable: string[] = [];
  for (const id of distTo.keys()) {
    if (id !== start.id && sinks.has(id)) reachable.push(id);
  }
  if (reachable.length === 0) {
    // The start is a dead-end lane: just drive to its end and leave.
    return sinks.has(start.id) ? [start] : null;
  }

  const destId = reachable[(rng() * reachable.length) | 0];
  return reconstruct(start, destId, laneById, prev);
}

function reconstruct(
  start: Lane,
  destId: string,
  laneById: Map<string, Lane>,
  prev: Map<string, { conn: Connector; from: Lane }>
): PathEl[] {
  const lanes: Lane[] = [];
  const conns: Connector[] = [];
  let curId = destId;
  while (curId !== start.id) {
    const step = prev.get(curId)!;
    lanes.unshift(laneById.get(curId)!);
    conns.unshift(step.conn);
    curId = step.from.id;
  }
  lanes.unshift(start);

  const route: PathEl[] = [];
  for (let i = 0; i < lanes.length; i++) {
    route.push(lanes[i]);
    if (i < conns.length) route.push(conns[i]);
  }
  return route;
}

/** Minimal binary min-heap keyed by a number. */
class MinHeap<T> {
  private items: { item: T; key: number }[] = [];

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(item: T, key: number): void {
    const a = this.items;
    a.push({ item, key });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): { item: T; key: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < a.length && a[l].key < a[smallest].key) smallest = l;
        if (r < a.length && a[r].key < a[smallest].key) smallest = r;
        if (smallest === i) break;
        [a[smallest], a[i]] = [a[i], a[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}
