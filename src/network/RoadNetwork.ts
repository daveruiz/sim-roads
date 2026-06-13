import { Vec2 } from "../core/vec.ts";
import { straightControls } from "../core/bezier.ts";
import { nextId } from "../core/id.ts";
import { RoadNode, Segment, Sign, SignType, BuiltGraph } from "./types.ts";
import { buildGraph } from "./build.ts";

export interface SerializedNetwork {
  nodes: RoadNode[];
  segments: Segment[];
  signs: Sign[];
}

/**
 * The editable road network plus a cached, derived runtime graph. Any edit
 * marks the graph dirty; `graph` rebuilds lazily on next access.
 */
export class RoadNetwork {
  nodes = new Map<string, RoadNode>();
  segments = new Map<string, Segment>();
  signs: Sign[] = [];

  private _graph: BuiltGraph | null = null;

  get graph(): BuiltGraph {
    if (!this._graph) this._graph = buildGraph(this.nodes, this.segments, this.signs);
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

  deleteSegment(id: string): void {
    this.segments.delete(id);
    this.signs = this.signs.filter((s) => s.segment !== id);
    this.markDirty();
  }

  deleteNode(id: string): void {
    this.nodes.delete(id);
    for (const seg of [...this.segments.values()]) {
      if (seg.startNode === id || seg.endNode === id) this.deleteSegment(seg.id);
    }
    this.signs = this.signs.filter((s) => s.node !== id);
    this.markDirty();
  }

  setSign(segment: string, node: string, type: SignType | null): void {
    this.signs = this.signs.filter((s) => !(s.segment === segment && s.node === node));
    if (type) this.signs.push({ id: nextId("sign"), segment, node, type });
    this.markDirty();
  }

  /* ------------------------ serialization ------------------------ */

  serialize(): SerializedNetwork {
    return {
      nodes: [...this.nodes.values()],
      segments: [...this.segments.values()],
      signs: [...this.signs],
    };
  }

  static deserialize(data: SerializedNetwork): RoadNetwork {
    const net = new RoadNetwork();
    for (const n of data.nodes) net.nodes.set(n.id, n);
    for (const s of data.segments) net.segments.set(s.id, s);
    net.signs = data.signs ?? [];
    net.markDirty();
    return net;
  }
}
