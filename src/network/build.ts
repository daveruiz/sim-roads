import { Vec2, perp, add, scale, sub, angleOf } from "../core/vec.ts";
import { Polyline } from "../core/polyline.ts";
import { Cubic, samplePolyline } from "../core/bezier.ts";
import { nextId } from "../core/id.ts";
import {
  RoadNode,
  Segment,
  Sign,
  Lane,
  Connector,
  BuiltGraph,
  Control,
  Link,
  laneKey,
} from "./types.ts";

const LANE_SAMPLE_OFFSET = 0.5; // lane center sits half a lane from its edge
const STRAIGHT_ANGLE = 0.6; // rad (~34°): movements below this preserve lanes

/** Group lanes by their owning segment (each approach at a node). */
function groupBySegment(lanes: Lane[]): Map<string, Lane[]> {
  const map = new Map<string, Lane[]>();
  for (const lane of lanes) {
    const arr = map.get(lane.segment);
    if (arr) arr.push(lane);
    else map.set(lane.segment, [lane]);
  }
  return map;
}

/**
 * Order a single approach's lanes from the kerb (outer / keep-right side)
 * inward, following the `outer`/`inner` adjacency so it is correct for both
 * normal roads and laneFlip rings. ordered[0] is the outer (kerb) lane.
 */
function orderFromKerb(lanes: Lane[]): Lane[] {
  let cur = lanes.find((l) => !l.outer) ?? lanes[0]; // the kerb lane
  const out: Lane[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.inner as Lane;
  }
  return out;
}

/**
 * Connect an incoming approach to an outgoing approach following the Option-A
 * rule: a roughly straight movement preserves lanes (paired from the outer
 * edge, so a multi-lane road keeps all its lanes through the node); a turn or
 * merge joins only the outer (kerb-side) lane of each.
 */
function connectApproaches(
  node: string,
  inLanes: Lane[],
  outLanes: Lane[],
  add: (node: string, inLane: Lane, outLane: Lane, kind?: "through" | "change") => void
): void {
  const inK = orderFromKerb(inLanes); // [0] = outer (kerb), last = inner
  const outK = orderFromKerb(outLanes);
  const inOuter = inK[0];
  const outOuter = outK[0];
  if (!inOuter || !outOuter) return;

  const angle = Math.abs(
    signedAngle(inOuter.poly.dirAt(inOuter.poly.length), outOuter.poly.dirAt(0))
  );
  if (angle >= STRAIGHT_ANGLE) {
    add(node, inOuter, outOuter); // turn / merge: outer lane to outer lane
    return;
  }
  // Straight: pair lanes from the outer edge inward (clamp on count mismatch so
  // a lane drop merges and a lane gain stays reachable). Dedupe clamped repeats.
  const fi = inK.length;
  const fo = outK.length;
  const seen = new Set<string>();
  const link = (a: Lane, b: Lane, kind: "through" | "change") => {
    const key = `${a.id}|${b.id}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    add(node, a, b, kind);
  };
  for (let k = 0; k < Math.max(fi, fo); k++) {
    const a = inK[Math.min(k, fi - 1)];
    const b = outK[Math.min(k, fo - 1)];
    link(a, b, "through");
    // One-lane shifts through the node, so a route can drift in/out across
    // junctions (e.g. dive into a roundabout, then ease back out to the exit).
    if (b.outer) link(a, b.outer, "change");
    if (b.inner) link(a, b.inner, "change");
  }
}

/** Build the full runtime graph (lanes + connectors + conflicts) from the model. */
export function buildGraph(
  nodes: Map<string, RoadNode>,
  segments: Map<string, Segment>,
  signs: Sign[],
  links: Link[] = []
): BuiltGraph {
  const lanes: Lane[] = [];
  const lanesByEndNode = new Map<string, Lane[]>(); // node -> lanes ending here
  const lanesByStartNode = new Map<string, Lane[]>(); // node -> lanes starting here
  const laneByRef = new Map<string, Lane>(); // "seg|dir|index" -> lane

  // Per-node degree and junction radius, so lanes can be pulled back from real
  // junctions: the connectors then span the junction interior and vehicles
  // stop/cross within an area instead of all piling onto the node centre.
  const degree = new Map<string, number>();
  const jRadius = new Map<string, number>();
  for (const seg of segments.values()) {
    const hw = (seg.lanesForward + seg.lanesBackward) * seg.laneWidth * 0.5;
    for (const nid of [seg.startNode, seg.endNode]) {
      degree.set(nid, (degree.get(nid) ?? 0) + 1);
      jRadius.set(nid, Math.max(jRadius.get(nid) ?? 0, hw));
    }
  }
  const setbackOf = (nid: string): number =>
    (degree.get(nid) ?? 0) >= 3 ? (jRadius.get(nid) ?? 0) + 1 : 0;

  for (const seg of segments.values()) {
    const start = nodes.get(seg.startNode);
    const end = nodes.get(seg.endNode);
    if (!start || !end) continue;

    const cubic: Cubic = { p0: start.pos, p1: seg.h1, p2: seg.h2, p3: end.pos };
    const { points, tangents } = samplePolyline(cubic);
    const w = seg.laneWidth;
    const sbStart = setbackOf(seg.startNode);
    const sbEnd = setbackOf(seg.endNode);
    const side = seg.laneFlip ? -1 : 1; // -1 offsets lanes to the left of travel

    // perp(t) points to the driver's right (screen coords, y down). Forward
    // traffic keeps to the right of the centerline (drive-on-right).
    for (let i = 0; i < seg.lanesForward; i++) {
      const offset = (i + LANE_SAMPLE_OFFSET) * w * side;
      const pts = trimPoints(points.map((p, k) => add(p, scale(perp(tangents[k]), offset))), sbStart, sbEnd);
      const lane = makeLane(seg, seg.startNode, seg.endNode, i, "forward", pts);
      lanes.push(lane);
      indexLane(lanesByEndNode, lane.toNode, lane);
      indexLane(lanesByStartNode, lane.fromNode, lane);
      laneByRef.set(laneKey({ segment: seg.id, dir: "forward", index: i }), lane);
    }

    // Backward lanes sit on the left half and run end->start (points reversed).
    for (let j = 0; j < seg.lanesBackward; j++) {
      const offset = (j + LANE_SAMPLE_OFFSET) * w * side;
      const pts = points.map((p, k) => add(p, scale(perp(tangents[k]), -offset)));
      pts.reverse();
      // After reversing, travel order is end->start, so trim end-node first.
      const lane = makeLane(seg, seg.endNode, seg.startNode, j, "backward", trimPoints(pts, sbEnd, sbStart));
      lanes.push(lane);
      indexLane(lanesByEndNode, lane.toNode, lane);
      indexLane(lanesByStartNode, lane.fromNode, lane);
      laneByRef.set(laneKey({ segment: seg.id, dir: "backward", index: j }), lane);
    }
  }

  // Link each lane to its same-segment, same-direction neighbours so the
  // simulation can model lane changes. `outer` always points toward the kerb
  // (the keep-right side), `inner` toward the centre/overtaking side. For a
  // normal road the kerb is the higher index; for a laneFlip ring (lanes offset
  // to the inside of the circle) the kerb is the LOWER index, so the mapping is
  // reversed — this is what keeps roundabout traffic on the outer lane.
  const bySegDir = new Map<string, Lane[]>();
  for (const lane of lanes) {
    const key = `${lane.segment}|${lane.dir}`;
    const arr = bySegDir.get(key);
    if (arr) arr.push(lane);
    else bySegDir.set(key, [lane]);
  }
  for (const group of bySegDir.values()) {
    group.sort((a, b) => a.index - b.index);
    const flip = segments.get(group[0].segment)?.laneFlip ?? false;
    const last = group.length - 1;
    for (let i = 0; i < group.length; i++) {
      const lower = group[i - 1];
      const higher = group[i + 1];
      // toward-kerb = lower index when flipped, higher index otherwise
      group[i].outer = flip ? lower : higher;
      group[i].inner = flip ? higher : lower;
      // 0 at the kerb, 1 at the innermost lane
      const kerbRank = flip ? i : last - i;
      group[i].interiorness = last > 0 ? kerbRank / last : 0;
    }
  }

  // Map: "node|segment" approach -> sign control
  const controlOf = new Map<string, Control>();
  for (const s of signs) controlOf.set(`${s.node}|${s.segment}`, s.type);

  // Explicit links grouped by node (a node with links is in manual mode).
  const linksByNode = new Map<string, Link[]>();
  for (const link of links) {
    const arr = linksByNode.get(link.node);
    if (arr) arr.push(link);
    else linksByNode.set(link.node, [link]);
  }

  const connectors: Connector[] = [];
  const addConnector = (
    node: string,
    inLane: Lane,
    outLane: Lane,
    kind: "through" | "change" = "through"
  ): void => {
    const control = controlOf.get(`${node}|${inLane.segment}`) ?? "free";
    const conn = makeConnector(node, inLane, outLane, control, kind);
    if (!conn) return;
    inLane.outgoing.push(conn);
    connectors.push(conn);
  };

  for (const node of nodes.values()) {
    const manual = linksByNode.get(node.id);
    if (manual && manual.length) {
      // Manual mode: only the links the user defined.
      for (const link of manual) {
        const inLane = laneByRef.get(laneKey(link.from));
        const outLane = laneByRef.get(laneKey(link.to));
        if (!inLane || !outLane) continue; // stale link (lanes changed)
        if (inLane.toNode !== node.id || outLane.fromNode !== node.id) continue;
        addConnector(node.id, inLane, outLane);
      }
      continue;
    }
    // Automatic mode: connect approach to approach. STRAIGHT movements preserve
    // lanes (paired from the outer edge); TURNS / merges join the outer lane to
    // the outer lane (drive-on-right: you join or leave a road from its
    // outer/rightmost lane).
    const incoming = groupBySegment(lanesByEndNode.get(node.id) ?? []);
    const outgoing = groupBySegment(lanesByStartNode.get(node.id) ?? []);
    for (const [inSeg, inLanes] of incoming) {
      for (const [outSeg, outLanes] of outgoing) {
        if (inSeg === outSeg) continue; // no U-turn on the same road
        connectApproaches(node.id, inLanes, outLanes, addConnector);
      }
    }
  }

  computeConflicts(nodes, connectors);

  const sources = lanes.filter(
    (l) => !connectorsEndingAt(connectors, l).length
  );
  const sinks = new Set(
    lanes.filter((l) => l.outgoing.length === 0).map((l) => l.id)
  );

  return { lanes, connectors, sources, sinks };
}

/**
 * Trim arc length `fromStart`/`fromEnd` off the ends of a polyline, keeping the
 * interior shape. Used to pull lanes back from junction nodes.
 */
function trimPoints(pts: Vec2[], fromStart: number, fromEnd: number): Vec2[] {
  if (fromStart <= 0 && fromEnd <= 0) return pts;
  const poly = new Polyline(pts);
  const total = poly.length;
  let s0 = Math.min(fromStart, total * 0.45);
  let s1 = total - Math.min(fromEnd, total * 0.45);
  if (s1 <= s0 + 0.05) {
    const m = total / 2;
    s0 = Math.max(0, m - 0.5);
    s1 = m + 0.5;
  }
  const out: Vec2[] = [poly.posAt(s0)];
  for (let i = 0; i < pts.length; i++) {
    if (poly.cum[i] > s0 + 1e-3 && poly.cum[i] < s1 - 1e-3) out.push(pts[i]);
  }
  out.push(poly.posAt(s1));
  return out;
}

function makeLane(
  seg: Segment,
  fromNode: string,
  toNode: string,
  index: number,
  dir: "forward" | "backward",
  pts: Vec2[]
): Lane {
  return {
    id: nextId("lane"),
    segment: seg.id,
    fromNode,
    toNode,
    index,
    dir,
    poly: new Polyline(pts),
    speedLimit: seg.speedLimit,
    outgoing: [],
    interiorness: 0,
  };
}

function indexLane(map: Map<string, Lane[]>, node: string, lane: Lane): void {
  const arr = map.get(node);
  if (arr) arr.push(lane);
  else map.set(node, [lane]);
}

/** Build a short Bézier connector from the end of inLane to the start of outLane. */
function makeConnector(
  node: string,
  inLane: Lane,
  outLane: Lane,
  control: Control,
  kind: "through" | "change" = "through"
): Connector | null {
  const p0 = inLane.poly.posAt(inLane.poly.length);
  const p3 = outLane.poly.posAt(0);
  const inDir = inLane.poly.dirAt(inLane.poly.length);
  const outDir = outLane.poly.dirAt(0);

  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // Control handles continue the incoming/outgoing tangents for a smooth turn.
  const handle = Math.max(chord / 3, 1);
  const c: Cubic = {
    p0,
    p1: add(p0, scale(inDir, handle)),
    p2: sub(p3, scale(outDir, handle)),
    p3,
  };
  const { points } = samplePolyline(c);

  const turnAngle = signedAngle(inDir, outDir);

  return {
    id: nextId("conn"),
    node,
    from: inLane,
    to: outLane,
    poly: new Polyline(points),
    control,
    turnAngle,
    kind,
    conflicts: [],
  };
}

function signedAngle(a: Vec2, b: Vec2): number {
  let d = angleOf(b) - angleOf(a);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function connectorsEndingAt(connectors: Connector[], lane: Lane): Connector[] {
  return connectors.filter((c) => c.to === lane);
}

/**
 * Precompute geometric conflict points between connectors that belong to the
 * same node. Two connectors conflict where their polylines cross (and they do
 * not share the same origin or destination lane).
 */
function computeConflicts(
  nodes: Map<string, RoadNode>,
  connectors: Connector[]
): void {
  const byNode = new Map<string, Connector[]>();
  for (const c of connectors) {
    const arr = byNode.get(c.node);
    if (arr) arr.push(c);
    else byNode.set(c.node, [c]);
  }

  for (const node of nodes.keys()) {
    const list = byNode.get(node) ?? [];
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) {
        const a = list[i];
        const b = list[k];
        // Diverging from the same lane is resolved by car-following only.
        if (a.from === b.from) continue;
        if (a.to === b.to) {
          // Merging into the same lane: the conflict is the merge point itself
          // (the start of the shared destination lane). This lets a yielding
          // approach give way to circulating/through traffic — essential for
          // roundabouts, on-ramps and lane changes giving way to their target.
          addConflict(a, b, a.poly.length, b.poly.length, a.to.poly.posAt(0));
          continue;
        }
        // A lane-change connector only gives way where it merges (handled
        // above); holding it at every geometric crossing would gridlock busy
        // nodes (e.g. roundabouts) for no safety gain — car-following and the
        // proximity rule cover the rest.
        if (a.kind === "change" || b.kind === "change") continue;
        const hit = polylineCross(a.poly, b.poly);
        if (hit) addConflict(a, b, hit.sA, hit.sB, hit.point);
      }
    }
  }
}

function addConflict(
  a: Connector,
  b: Connector,
  sA: number,
  sB: number,
  point: Vec2
): void {
  a.conflicts.push({ other: b, sSelf: sA, sOther: sB, point });
  b.conflicts.push({ other: a, sSelf: sB, sOther: sA, point });
}

/** Find the first crossing point between two polylines and its arc lengths. */
function polylineCross(
  a: Polyline,
  b: Polyline
): { point: Vec2; sA: number; sB: number } | null {
  for (let i = 0; i < a.points.length - 1; i++) {
    const a1 = a.points[i];
    const a2 = a.points[i + 1];
    for (let j = 0; j < b.points.length - 1; j++) {
      const b1 = b.points[j];
      const b2 = b.points[j + 1];
      const hit = segIntersect(a1, a2, b1, b2);
      if (hit) {
        const sA = a.cum[i] + hit.tA * (a.cum[i + 1] - a.cum[i]);
        const sB = b.cum[j] + hit.tB * (b.cum[j + 1] - b.cum[j]);
        return { point: hit.point, sA, sB };
      }
    }
  }
  return null;
}

function segIntersect(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2
): { point: Vec2; tA: number; tB: number } | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const diff = sub(p3, p1);
  const tA = (diff.x * d2.y - diff.y * d2.x) / denom;
  const tB = (diff.x * d1.y - diff.y * d1.x) / denom;
  if (tA < 0 || tA > 1 || tB < 0 || tB > 1) return null;
  return { point: add(p1, scale(d1, tA)), tA, tB };
}
