import { RoadNetwork } from "../network/RoadNetwork.ts";
import { Vec2, dist } from "../core/vec.ts";
import { Camera } from "../render/Camera.ts";
import { samplePolyline, Cubic } from "../core/bezier.ts";
import { Segment, SignType, LaneRef } from "../network/types.ts";

export type EditorTool = "select" | "road" | "sign" | "delete" | "connect";

type Drag =
  | { kind: "node"; id: string }
  | { kind: "handle"; segId: string; which: "h1" | "h2" }
  | null;

/** A drawable lane endpoint at a node, used to wire manual connectors. */
export interface LaneAnchor {
  ref: LaneRef;
  node: string;
  pos: Vec2;
  kind: "in" | "out"; // incoming lane end / outgoing lane start
}

/** Handles editor pointer interactions: building and shaping the network. */
export class Editor {
  tool: EditorTool = "road";
  selectedSegment: string | null = null;
  pendingNode: string | null = null;
  hoverNode: string | null = null;
  cursorWorld: Vec2 | null = null;

  /** Connector tool state. */
  linkFrom: { ref: LaneRef; node: string } | null = null;
  linkHoverNode: string | null = null;

  private drag: Drag = null;

  constructor(private net: RoadNetwork, private camera: Camera) {}

  /**
   * Try to start dragging a node or Bézier handle (select tool only). Returns
   * true if a drag began, so the caller knows not to treat the gesture as a pan.
   */
  beginDrag(world: Vec2): boolean {
    this.cursorWorld = world;
    if (this.tool !== "select") return false;

    // Bézier handle of the selected segment takes priority.
    if (this.selectedSegment) {
      const seg = this.net.segments.get(this.selectedSegment);
      if (seg) {
        if (dist(seg.h1, world) < this.pickRadius()) {
          this.drag = { kind: "handle", segId: seg.id, which: "h1" };
          return true;
        }
        if (dist(seg.h2, world) < this.pickRadius()) {
          this.drag = { kind: "handle", segId: seg.id, which: "h2" };
          return true;
        }
      }
    }
    const node = this.nodeAt(world);
    if (node) {
      this.drag = { kind: "node", id: node.id };
      return true;
    }
    return false;
  }

  /** Apply the active tool at a tapped/clicked point (no drag). */
  tap(world: Vec2): void {
    this.cursorWorld = world;
    switch (this.tool) {
      case "select":
        this.selectedSegment = this.segmentAt(world)?.id ?? null;
        break;
      case "road":
        this.placeRoad(world);
        break;
      case "sign":
        this.cycleSign(world);
        break;
      case "delete":
        this.deleteAt(world);
        break;
      case "connect":
        this.placeLink(world);
        break;
    }
  }

  /** Update hover/cursor state (called on move, and on touch press). */
  hover(world: Vec2): void {
    this.cursorWorld = world;
    this.hoverNode = this.nodeAt(world)?.id ?? null;
    if (this.tool === "connect") {
      this.linkHoverNode = this.nearestNode(world, 40)?.id ?? null;
    }
  }

  onPointerMove(world: Vec2): void {
    this.hover(world);
    if (!this.drag) return;
    if (this.drag.kind === "node") {
      this.net.moveNode(this.drag.id, world);
    } else {
      const seg = this.net.segments.get(this.drag.segId);
      if (seg) this.net.updateSegment(seg.id, { [this.drag.which]: { ...world } });
    }
  }

  /** True while a node/handle drag is in progress. */
  get isDragging(): boolean {
    return this.drag != null;
  }

  onPointerUp(): void {
    this.drag = null;
  }

  cancel(): void {
    this.pendingNode = null;
    this.linkFrom = null;
    this.drag = null;
  }

  /** Revert the node currently under the cursor to automatic connectors. */
  resetHoveredNodeToAuto(): void {
    const node = this.linkHoverNode ?? this.hoverNode;
    if (node) this.net.clearNodeLinks(node);
  }

  /* ------------------------ connector tool ----------------------- */

  /** Lane endpoints (anchors) at a node, for wiring manual connectors. */
  anchorsAt(node: string): LaneAnchor[] {
    const out: LaneAnchor[] = [];
    for (const lane of this.net.graph.lanes) {
      const ref: LaneRef = { segment: lane.segment, dir: lane.dir, index: lane.index };
      if (lane.toNode === node) {
        out.push({ ref, node, pos: lane.poly.posAt(lane.poly.length), kind: "in" });
      }
      if (lane.fromNode === node) {
        out.push({ ref, node, pos: lane.poly.posAt(0), kind: "out" });
      }
    }
    return out;
  }

  /** All lane anchors across every node (one pass), for the connector overlay. */
  allAnchors(): LaneAnchor[] {
    const out: LaneAnchor[] = [];
    for (const lane of this.net.graph.lanes) {
      const ref: LaneRef = { segment: lane.segment, dir: lane.dir, index: lane.index };
      out.push({ ref, node: lane.toNode, pos: lane.poly.posAt(lane.poly.length), kind: "in" });
      out.push({ ref, node: lane.fromNode, pos: lane.poly.posAt(0), kind: "out" });
    }
    return out;
  }

  private nearestAnchor(world: Vec2): LaneAnchor | null {
    const r = Math.max(this.pickRadius(), 1.6);
    let best: LaneAnchor | null = null;
    let bestD = r;
    const nodes = this.linkHoverNode ? [this.linkHoverNode] : [...this.net.nodes.keys()];
    for (const n of nodes) {
      for (const a of this.anchorsAt(n)) {
        const d = dist(a.pos, world);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
    }
    return best;
  }

  private placeLink(world: Vec2): boolean {
    const a = this.nearestAnchor(world);
    if (!a) {
      this.linkFrom = null; // clicked empty space: clear selection (allow pan)
      return false;
    }
    if (a.kind === "in") {
      this.linkFrom = { ref: a.ref, node: a.node };
      return true;
    }
    // Outgoing anchor: complete the connection if a source is selected here.
    if (this.linkFrom && this.linkFrom.node === a.node) {
      this.net.toggleLink(a.node, this.linkFrom.ref, a.ref); // keep source for chaining
    }
    return true;
  }

  /* --------------------------- tools ----------------------------- */

  private placeRoad(world: Vec2): void {
    const existing = this.nodeAt(world);
    const nodeId = existing ? existing.id : this.net.addNode(world).id;
    if (this.pendingNode && this.pendingNode !== nodeId) {
      const seg = this.net.addSegment(this.pendingNode, nodeId);
      this.selectedSegment = seg.id;
    }
    this.pendingNode = nodeId; // chain to keep drawing connected roads
  }

  private cycleSign(world: Vec2): void {
    const hit = this.approachAt(world);
    if (!hit) return;
    const current = this.net.signs.find(
      (s) => s.segment === hit.seg.id && s.node === hit.node
    );
    const order: (SignType | null)[] = [null, "yield", "stop"];
    const idx = order.indexOf(current?.type ?? null);
    const next = order[(idx + 1) % order.length];
    this.net.setSign(hit.seg.id, hit.node, next);
  }

  private deleteAt(world: Vec2): void {
    const node = this.nodeAt(world);
    if (node) {
      this.net.deleteNode(node.id);
      if (this.pendingNode === node.id) this.pendingNode = null;
      return;
    }
    const seg = this.segmentAt(world);
    if (seg) {
      this.net.deleteSegment(seg.id);
      if (this.selectedSegment === seg.id) this.selectedSegment = null;
    }
  }

  /* ------------------------- hit testing ------------------------- */

  private pickRadius(): number {
    return 8 / this.camera.zoom; // ~8 screen px in world units
  }

  /** Nearest node within `range` world units, or null. */
  nearestNode(world: Vec2, range: number): { id: string; pos: Vec2 } | null {
    let best: { id: string; pos: Vec2 } | null = null;
    let bestD = range;
    for (const n of this.net.nodes.values()) {
      const d = dist(n.pos, world);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  nodeAt(world: Vec2): { id: string; pos: Vec2 } | null {
    const r = Math.max(this.pickRadius(), 1.5);
    let best: { id: string; pos: Vec2 } | null = null;
    let bestD = r;
    for (const n of this.net.nodes.values()) {
      const d = dist(n.pos, world);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  segmentAt(world: Vec2): Segment | null {
    let best: Segment | null = null;
    let bestD = Infinity;
    for (const seg of this.net.segments.values()) {
      const a = this.net.nodes.get(seg.startNode);
      const b = this.net.nodes.get(seg.endNode);
      if (!a || !b) continue;
      const cubic: Cubic = { p0: a.pos, p1: seg.h1, p2: seg.h2, p3: b.pos };
      const { points } = samplePolyline(cubic);
      const halfWidth = (seg.lanesForward + seg.lanesBackward) * seg.laneWidth * 0.5;
      const d = polylineDistance(points, world);
      if (d < halfWidth && d < bestD) {
        bestD = d;
        best = seg;
      }
    }
    return best;
  }

  /** The approach (segment + which node) nearest to the click, for signs. */
  private approachAt(world: Vec2): { seg: Segment; node: string } | null {
    const seg = this.segmentAt(world);
    if (!seg) return null;
    const a = this.net.nodes.get(seg.startNode)!;
    const b = this.net.nodes.get(seg.endNode)!;
    const node = dist(world, a.pos) < dist(world, b.pos) ? seg.startNode : seg.endNode;
    return { seg, node };
  }
}

function polylineDistance(points: Vec2[], p: Vec2): number {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, segDist(points[i], points[i + 1], p));
  }
  return min;
}

function segDist(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 < 1e-9 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
