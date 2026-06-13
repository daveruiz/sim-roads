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
  Conflict,
  BuiltGraph,
  Control,
} from "./types.ts";

const LANE_SAMPLE_OFFSET = 0.5; // lane center sits half a lane from its edge

/** Build the full runtime graph (lanes + connectors + conflicts) from the model. */
export function buildGraph(
  nodes: Map<string, RoadNode>,
  segments: Map<string, Segment>,
  signs: Sign[]
): BuiltGraph {
  const lanes: Lane[] = [];
  const lanesByEndNode = new Map<string, Lane[]>(); // node -> lanes ending here
  const lanesByStartNode = new Map<string, Lane[]>(); // node -> lanes starting here

  for (const seg of segments.values()) {
    const start = nodes.get(seg.startNode);
    const end = nodes.get(seg.endNode);
    if (!start || !end) continue;

    const cubic: Cubic = { p0: start.pos, p1: seg.h1, p2: seg.h2, p3: end.pos };
    const { points, tangents } = samplePolyline(cubic);
    const w = seg.laneWidth;

    // perp(t) points to the driver's right (screen coords, y down). Forward
    // traffic keeps to the right of the centerline (drive-on-right).
    for (let i = 0; i < seg.lanesForward; i++) {
      const offset = (i + LANE_SAMPLE_OFFSET) * w;
      const pts = points.map((p, k) => add(p, scale(perp(tangents[k]), offset)));
      const lane = makeLane(seg, seg.startNode, seg.endNode, i, "forward", pts);
      lanes.push(lane);
      indexLane(lanesByEndNode, lane.toNode, lane);
      indexLane(lanesByStartNode, lane.fromNode, lane);
    }

    // Backward lanes sit on the left half and run end->start (points reversed).
    for (let j = 0; j < seg.lanesBackward; j++) {
      const offset = (j + LANE_SAMPLE_OFFSET) * w;
      const pts = points.map((p, k) => add(p, scale(perp(tangents[k]), -offset)));
      pts.reverse();
      const lane = makeLane(seg, seg.endNode, seg.startNode, j, "backward", pts);
      lanes.push(lane);
      indexLane(lanesByEndNode, lane.toNode, lane);
      indexLane(lanesByStartNode, lane.fromNode, lane);
    }
  }

  // Map: "node|segment" approach -> sign control
  const controlOf = new Map<string, Control>();
  for (const s of signs) controlOf.set(`${s.node}|${s.segment}`, s.type);

  const connectors: Connector[] = [];
  for (const node of nodes.values()) {
    const incoming = lanesByEndNode.get(node.id) ?? [];
    const outgoing = lanesByStartNode.get(node.id) ?? [];
    for (const inLane of incoming) {
      const control = controlOf.get(`${node.id}|${inLane.segment}`) ?? "free";
      for (const outLane of outgoing) {
        // No U-turn back onto the same segment.
        if (outLane.segment === inLane.segment) continue;
        const conn = makeConnector(node.id, inLane, outLane, control);
        if (!conn) continue;
        inLane.outgoing.push(conn);
        connectors.push(conn);
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
  control: Control
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
        // Merging from the same incoming lane or into the same outgoing lane is
        // handled by car-following, not by conflict resolution.
        if (a.from === b.from || a.to === b.to) continue;
        const hit = polylineCross(a.poly, b.poly);
        if (!hit) continue;
        const ca: Conflict = { other: b, sSelf: hit.sA, sOther: hit.sB, point: hit.point };
        const cb: Conflict = { other: a, sSelf: hit.sB, sOther: hit.sA, point: hit.point };
        a.conflicts.push(ca);
        b.conflicts.push(cb);
      }
    }
  }
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
