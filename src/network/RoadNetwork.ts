import { Vec2 } from "../core/vec.ts";
import { straightControls } from "../core/bezier.ts";
import { nextId } from "../core/id.ts";
import {
  RoadNode,
  Segment,
  Sign,
  SignType,
  BuiltGraph,
  Link,
  LaneRef,
  sameLaneRef,
} from "./types.ts";
import { buildGraph } from "./build.ts";

export interface SerializedNetwork {
  nodes: RoadNode[];
  segments: Segment[];
  signs: Sign[];
  links?: Link[];
}

/**
 * The editable road network plus a cached, derived runtime graph. Any edit
 * marks the graph dirty; `graph` rebuilds lazily on next access.
 */
export class RoadNetwork {
  nodes = new Map<string, RoadNode>();
  segments = new Map<string, Segment>();
  signs: Sign[] = [];
  links: Link[] = [];

  private _graph: BuiltGraph | null = null;

  get graph(): BuiltGraph {
    if (!this._graph) {
      this._graph = buildGraph(this.nodes, this.segments, this.signs, this.links);
    }
    return this._graph;
  }

  markDirty(): void {
    this._graph = null;
  }

  /* --------------------------- editing --------------------------- */

  addNode(pos: Vec2): RoadNode {
    const node: RoadNode = { id: nextId("node"), pos: { ...pos } };
    this.nodes.set(node.id, node);
    this.markDirty();
    return node;
  }

  moveNode(id: string, pos: Vec2): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.pos = { ...pos };
    this.markDirty();
  }

  addSegment(startNode: string, endNode: string, opts?: Partial<Segment>): Segment {
    const a = this.nodes.get(startNode)!;
    const b = this.nodes.get(endNode)!;
    const { p1, p2 } = straightControls(a.pos, b.pos);
    const seg: Segment = {
      id: nextId("seg"),
      startNode,
      endNode,
      h1: opts?.h1 ?? p1,
      h2: opts?.h2 ?? p2,
      lanesForward: opts?.lanesForward ?? 1,
      lanesBackward: opts?.lanesBackward ?? 1,
      laneWidth: opts?.laneWidth ?? 3.5,
      speedLimit: opts?.speedLimit ?? 13.9, // ~50 km/h
    };
    this.segments.set(seg.id, seg);
    this.markDirty();
    return seg;
  }

  updateSegment(id: string, patch: Partial<Segment>): void {
    const seg = this.segments.get(id);
    if (!seg) return;
    Object.assign(seg, patch);
    this.markDirty();
  }

  /** True if a node is used by more than one segment (a real junction). */
  nodeDegree(nodeId: string): number {
    let n = 0;
    for (const seg of this.segments.values()) {
      if (seg.startNode === nodeId) n++;
      if (seg.endNode === nodeId) n++;
    }
    return n;
  }

  /**
   * Reassign one end of a segment to a different node. Signs on that approach
   * follow the segment; manual links at the old node that referenced this
   * segment are dropped (the approach changed). An orphaned old node is removed.
   */
  setSegmentEndpoint(segId: string, which: "start" | "end", nodeId: string): void {
    const seg = this.segments.get(segId);
    if (!seg || !this.nodes.has(nodeId)) return;
    const old = which === "start" ? seg.startNode : seg.endNode;
    if (old === nodeId) return;
    if (which === "start") seg.startNode = nodeId;
    else seg.endNode = nodeId;

    for (const s of this.signs) if (s.segment === segId && s.node === old) s.node = nodeId;
    this.links = this.links.filter(
      (l) => !(l.node === old && (l.from.segment === segId || l.to.segment === segId))
    );
    if (this.nodeDegree(old) === 0) this.nodes.delete(old);
    this.markDirty();
  }

  /**
   * Detach one end of a segment from its (shared) node onto a fresh node at the
   * same position, so it can be dragged away and reconnected. Returns the new
   * node id.
   */
  detachEndpoint(segId: string, which: "start" | "end"): string | null {
    const seg = this.segments.get(segId);
    if (!seg) return null;
    const oldId = which === "start" ? seg.startNode : seg.endNode;
    const old = this.nodes.get(oldId);
    if (!old) return null;
    const fresh = this.addNode({ ...old.pos });
    this.setSegmentEndpoint(segId, which, fresh.id);
    return fresh.id;
  }

  deleteSegment(id: string): void {
    this.segments.delete(id);
    this.signs = this.signs.filter((s) => s.segment !== id);
    this.links = this.links.filter(
      (l) => l.from.segment !== id && l.to.segment !== id
    );
    this.markDirty();
  }

  deleteNode(id: string): void {
    this.nodes.delete(id);
    for (const seg of [...this.segments.values()]) {
      if (seg.startNode === id || seg.endNode === id) this.deleteSegment(seg.id);
    }
    this.signs = this.signs.filter((s) => s.node !== id);
    this.links = this.links.filter((l) => l.node !== id);
    this.markDirty();
  }

  setSign(segment: string, node: string, type: SignType | null): void {
    this.signs = this.signs.filter((s) => !(s.segment === segment && s.node === node));
    if (type) this.signs.push({ id: nextId("sign"), segment, node, type });
    this.markDirty();
  }

  /* ----------------------- explicit links ------------------------ */

  /** Toggle a manual lane-to-lane connection at a node. */
  toggleLink(node: string, from: LaneRef, to: LaneRef): void {
    const idx = this.links.findIndex(
      (l) => l.node === node && sameLaneRef(l.from, from) && sameLaneRef(l.to, to)
    );
    if (idx >= 0) this.links.splice(idx, 1);
    else this.links.push({ id: nextId("link"), node, from, to });
    this.markDirty();
  }

  hasLink(node: string, from: LaneRef, to: LaneRef): boolean {
    return this.links.some(
      (l) => l.node === node && sameLaneRef(l.from, from) && sameLaneRef(l.to, to)
    );
  }

  nodeHasLinks(node: string): boolean {
    return this.links.some((l) => l.node === node);
  }

  /** Revert a node to automatic (all-to-all) connector generation. */
  clearNodeLinks(node: string): void {
    this.links = this.links.filter((l) => l.node !== node);
    this.markDirty();
  }

  /* ------------------------ serialization ------------------------ */

  serialize(): SerializedNetwork {
    return {
      nodes: [...this.nodes.values()],
      segments: [...this.segments.values()],
      signs: [...this.signs],
      links: [...this.links],
    };
  }

  static deserialize(data: SerializedNetwork): RoadNetwork {
    const net = new RoadNetwork();
    for (const n of data.nodes) net.nodes.set(n.id, n);
    for (const s of data.segments) net.segments.set(s.id, s);
    net.signs = data.signs ?? [];
    net.links = data.links ?? [];
    net.markDirty();
    return net;
  }
}
