import { Vec2 } from "../core/vec.ts";
import { Polyline } from "../core/polyline.ts";

/* ------------------------------------------------------------------ *
 * EDITABLE MODEL
 * The user manipulates Nodes, Segments and Signs in the editor. Lanes,
 * Connectors and Conflicts are *derived* from these by the build step.
 * ------------------------------------------------------------------ */

/** A junction / endpoint where segments meet. */
export interface RoadNode {
  id: string;
  pos: Vec2;
}

/**
 * A road between two nodes, shaped as a cubic Bézier (handles h1/h2 are the
 * Bézier control points relative offsets are stored as absolute points).
 * Lanes are generated on both sides of the centerline (drive-on-right).
 */
export interface Segment {
  id: string;
  startNode: string;
  endNode: string;
  h1: Vec2; // first Bézier control point (near startNode)
  h2: Vec2; // second Bézier control point (near endNode)
  lanesForward: number; // lanes in start -> end direction
  lanesBackward: number; // lanes in end -> start direction
  laneWidth: number;
  speedLimit: number; // m/s
  /**
   * Offset lanes to the LEFT of travel instead of the default right. Lets a
   * one-way ring keep its circulation sense while its lanes/asphalt sit on the
   * inside of the circle (so spokes meet the outer edge). No effect on flow.
   */
  laneFlip?: boolean;
}

export type SignType = "yield" | "stop";

/**
 * A traffic sign controlling an approach: the traffic coming from `segment`
 * arriving at `node`. It governs the connectors leaving that approach.
 */
export interface Sign {
  id: string;
  segment: string;
  node: string;
  type: SignType;
}

/**
 * A stable reference to a derived lane (lanes are rebuilt on every edit, so we
 * reference them by segment + direction + index rather than by runtime id).
 */
export interface LaneRef {
  segment: string;
  dir: "forward" | "backward";
  index: number;
}

/**
 * An explicit lane-to-lane connection through a node. If a node has any links,
 * ONLY those connectors are built for it (manual mode); otherwise every
 * compatible turn is generated automatically.
 */
export interface Link {
  id: string;
  node: string;
  from: LaneRef;
  to: LaneRef;
}

export function laneKey(ref: LaneRef): string {
  return `${ref.segment}|${ref.dir}|${ref.index}`;
}

export function sameLaneRef(a: LaneRef, b: LaneRef): boolean {
  return a.segment === b.segment && a.dir === b.dir && a.index === b.index;
}

/* ------------------------------------------------------------------ *
 * DERIVED RUNTIME GRAPH
 * ------------------------------------------------------------------ */

export type Control = "free" | "yield" | "stop";

/** A single drivable lane belonging to a segment. */
export interface Lane {
  id: string;
  segment: string;
  fromNode: string;
  toNode: string;
  index: number; // 0 = nearest centerline
  dir: "forward" | "backward";
  poly: Polyline;
  speedLimit: number;
  outgoing: Connector[]; // connectors leaving the end of this lane
  /**
   * Adjacent same-direction lanes on the same segment, for lane changes.
   * `inner` is one lane toward the centre (the overtaking side); `outer` is one
   * lane toward the kerb (the keep-right side). Undefined at the edges.
   */
  inner?: Lane;
  outer?: Lane;
  /** 0 = outermost (kerb) lane, 1 = innermost; used to bias lane choice. */
  interiorness: number;
}

/** A short path through a node joining an incoming lane to an outgoing lane. */
export interface Connector {
  id: string;
  node: string;
  from: Lane;
  to: Lane;
  poly: Polyline;
  control: Control; // right-of-way rule for vehicles entering this connector
  turnAngle: number; // signed turn angle in radians (left negative / right positive)
  /**
   * "through" = a normal movement (straight or turn); "change" = a one-lane
   * shift to an adjacent parallel lane while continuing roughly straight, so a
   * route can move between lanes (e.g. dive inside a roundabout, then drift out
   * to the exit). Change connectors carry a routing penalty.
   */
  kind: "through" | "change";
  /** Conflict points with other connectors at the same node. */
  conflicts: Conflict[];
}

/** A geometric crossing between two connectors at a node. */
export interface Conflict {
  other: Connector;
  sSelf: number; // arc length along this connector to the crossing point
  sOther: number; // arc length along the other connector to the crossing point
  point: Vec2;
}

/** Result of building the runtime graph. */
export interface BuiltGraph {
  lanes: Lane[];
  connectors: Connector[];
  /** Lanes that have no incoming connector — valid spawn sources. */
  sources: Lane[];
  /** Lanes that have no outgoing connector — valid exits / sinks. */
  sinks: Set<string>;
}
