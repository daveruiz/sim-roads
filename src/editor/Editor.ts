import { RoadNetwork } from "../network/RoadNetwork.ts";
import { Vec2, dist } from "../core/vec.ts";
import { Camera } from "../render/Camera.ts";
import { samplePolyline, Cubic } from "../core/bezier.ts";
import { Segment, SignType } from "../network/types.ts";

export type EditorTool = "select" | "road" | "sign" | "delete";

type Drag =
  | { kind: "node"; id: string }
  | { kind: "handle"; segId: string; which: "h1" | "h2" }
  | null;

/** Handles editor pointer interactions: building and shaping the network. */
export class Editor {
  tool: EditorTool = "road";
  selectedSegment: string | null = null;
  pendingNode: string | null = null;
  hoverNode: string | null = null;
  cursorWorld: Vec2 | null = null;

  private drag: Drag = null;

  constructor(private net: RoadNetwork, private camera: Camera) {}

  /** True if the editor consumed the press (so the app shouldn't pan). */
  onPointerDown(world: Vec2): boolean {
    this.cursorWorld = world;
    switch (this.tool) {
      case "select":
        return this.startSelectOrDrag(world);
      case "road":
        this.placeRoad(world);
        return true;
      case "sign":
        this.cycleSign(world);
        return true;
      case "delete":
        this.deleteAt(world);
        return true;
    }
  }

  onPointerMove(world: Vec2): void {
    this.cursorWorld = world;
    this.hoverNode = this.nodeAt(world)?.id ?? null;
    if (!this.drag) return;
    if (this.drag.kind === "node") {
      this.net.moveNode(this.drag.id, world);
    } else {
      const seg = this.net.segments.get(this.drag.segId);
      if (seg) this.net.updateSegment(seg.id, { [this.drag.which]: { ...world } });
    }
  }

  onPointerUp(): void {
    this.drag = null;
  }

  cancel(): void {
    this.pendingNode = null;
    this.drag = null;
  }

  /* --------------------------- tools ----------------------------- */

  private startSelectOrDrag(world: Vec2): boolean {
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
    const seg = this.segmentAt(world);
    this.selectedSegment = seg?.id ?? null;
    return seg != null;
  }

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
