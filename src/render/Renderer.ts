import { Camera } from "./Camera.ts";
import { RoadNetwork } from "../network/RoadNetwork.ts";
import { Simulation } from "../sim/Simulation.ts";
import { Vec2, perp, add, scale, angleOf, normalize, sub } from "../core/vec.ts";
import { Cubic, samplePolyline } from "../core/bezier.ts";
import { Segment, LaneRef, sameLaneRef } from "../network/types.ts";
import { LaneAnchor } from "../editor/Editor.ts";

export interface RenderOptions {
  mode: "editor" | "sim";
  selectedSegment: string | null;
  showConflicts: boolean;
  hoverNode: string | null;
  pendingStart: Vec2 | null; // when drawing a new segment
  cursorWorld: Vec2 | null;
  connectMode: boolean;
  anchors: LaneAnchor[];
  linkFrom: LaneRef | null;
  linkHoverNode: string | null;
}

const COLORS = {
  bg: "#1d2128",
  grid: "#262b34",
  asphalt: "#3a3f47",
  junction: "#34383f",
  centerLine: "#f2c14e",
  laneLine: "#cfd3da",
  edgeLine: "#9aa0a8",
  node: "#7fd0ff",
  nodeHover: "#ffffff",
  handle: "#ff8a5c",
  selected: "#ffd24f",
  stop: "#ff4d4d",
  yield: "#ffb000",
  laneArrow: "rgba(220,225,235,0.55)",
  connector: "#5cf2c8",
  anchorIn: "#4fa8ff",
  anchorOut: "#7CFC9A",
  anchorSel: "#ffffff",
};

/** Draws the road network and simulation onto a canvas in world coordinates. */
export class Renderer {
  ctx: CanvasRenderingContext2D;

  constructor(
    public canvas: HTMLCanvasElement,
    public camera: Camera,
    public net: RoadNetwork,
    public sim: Simulation
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  render(opts: RenderOptions): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    this.camera.apply(ctx);

    this.drawGrid(w, h);
    this.drawJunctions();
    this.drawSegments(opts);
    if (opts.mode === "editor") this.drawLaneArrows();
    this.drawSigns();

    if (opts.connectMode) this.drawConnectMode(opts);
    if (opts.mode === "editor") this.drawEditorOverlay(opts);
    if (opts.showConflicts) this.drawConflicts();
    if (opts.mode === "sim") this.drawVehicles();

    ctx.restore();
    ctx.restore();
  }

  /* --------------------------- helpers --------------------------- */

  private centerline(seg: Segment): { points: Vec2[]; tangents: Vec2[] } | null {
    const a = this.net.nodes.get(seg.startNode);
    const b = this.net.nodes.get(seg.endNode);
    if (!a || !b) return null;
    const cubic: Cubic = { p0: a.pos, p1: seg.h1, p2: seg.h2, p3: b.pos };
    return samplePolyline(cubic);
  }

  private stroke(points: Vec2[], width: number, color: string, dash?: number[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private offsetLine(
    points: Vec2[],
    tangents: Vec2[],
    offset: number,
    width: number,
    color: string,
    dash?: number[]
  ): void {
    const pts = points.map((p, i) => add(p, scale(perp(tangents[i]), offset)));
    this.stroke(pts, width, color, dash);
  }

  /* ---------------------------- layers --------------------------- */

  private drawGrid(w: number, h: number): void {
    const ctx = this.ctx;
    const tl = this.camera.screenToWorld({ x: 0, y: 0 });
    const br = this.camera.screenToWorld({ x: w, y: h });
    const step = 20;
    ctx.lineWidth = 0.4 / this.camera.zoom;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) {
      ctx.moveTo(x, tl.y);
      ctx.lineTo(x, br.y);
    }
    for (let y = Math.floor(tl.y / step) * step; y < br.y; y += step) {
      ctx.moveTo(tl.x, y);
      ctx.lineTo(br.x, y);
    }
    ctx.stroke();
  }

  private drawJunctions(): void {
    const ctx = this.ctx;
    // Fill a disc at each node sized to the widest connected road.
    for (const node of this.net.nodes.values()) {
      let radius = 2;
      for (const seg of this.net.segments.values()) {
        if (seg.startNode === node.id || seg.endNode === node.id) {
          const wTotal = (seg.lanesForward + seg.lanesBackward) * seg.laneWidth;
          radius = Math.max(radius, wTotal / 2);
        }
      }
      ctx.beginPath();
      ctx.arc(node.pos.x, node.pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.junction;
      ctx.fill();
    }
  }

  private drawSegments(opts: RenderOptions): void {
    for (const seg of this.net.segments.values()) {
      const cl = this.centerline(seg);
      if (!cl) continue;
      const { points, tangents } = cl;
      const w = seg.laneWidth;
      const F = seg.lanesForward;
      const B = seg.lanesBackward;
      const total = (F + B) * w;

      // Asphalt: forward lanes sit on the right (+perp), backward on the left
      // (-perp). Centre the asphalt band over both halves.
      const mid = (F - B) * w * 0.5; // band centre offset from geometric centerline
      const asphalt = points.map((p, i) => add(p, scale(perp(tangents[i]), mid)));
      this.stroke(asphalt, total, COLORS.asphalt);

      // Outer edge lines.
      this.offsetLine(points, tangents, F * w, 0.18, COLORS.edgeLine);
      this.offsetLine(points, tangents, -B * w, 0.18, COLORS.edgeLine);

      // Centre divider between opposing flows (solid yellow when two-way).
      if (F > 0 && B > 0) this.offsetLine(points, tangents, 0, 0.22, COLORS.centerLine);

      // Dashed lane separators within each direction.
      for (let i = 1; i < F; i++)
        this.offsetLine(points, tangents, i * w, 0.14, COLORS.laneLine, [2.5, 3]);
      for (let j = 1; j < B; j++)
        this.offsetLine(points, tangents, -j * w, 0.14, COLORS.laneLine, [2.5, 3]);

      if (opts.selectedSegment === seg.id) {
        this.stroke(asphalt, total + 0.6, COLORS.selected);
        this.stroke(asphalt, total, COLORS.asphalt);
      }
    }
  }

  private drawSigns(): void {
    const ctx = this.ctx;
    for (const sign of this.net.signs) {
      const node = this.net.nodes.get(sign.node);
      const seg = this.net.segments.get(sign.segment);
      if (!node || !seg) continue;
      // Place the marker a little back along the segment from the node.
      const other = seg.startNode === sign.node ? seg.endNode : seg.startNode;
      const op = this.net.nodes.get(other);
      if (!op) continue;
      const dx = op.pos.x - node.pos.x;
      const dy = op.pos.y - node.pos.y;
      const l = Math.hypot(dx, dy) || 1;
      const back = (seg.lanesForward + seg.lanesBackward) * seg.laneWidth * 0.5 + 2;
      const px = node.pos.x + (dx / l) * back;
      const py = node.pos.y + (dy / l) * back;
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = sign.type === "stop" ? COLORS.stop : COLORS.yield;
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "1.6px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sign.type === "stop" ? "S" : "▽", px, py);
    }
  }

  private drawEditorOverlay(opts: RenderOptions): void {
    const ctx = this.ctx;

    // Pending segment preview.
    if (opts.pendingStart && opts.cursorWorld) {
      this.stroke([opts.pendingStart, opts.cursorWorld], 0.4, COLORS.selected, [2, 2]);
    }

    // Bézier handles for the selected segment.
    if (opts.selectedSegment) {
      const seg = this.net.segments.get(opts.selectedSegment);
      if (seg) {
        const a = this.net.nodes.get(seg.startNode)!;
        const b = this.net.nodes.get(seg.endNode)!;
        this.stroke([a.pos, seg.h1], 0.12, COLORS.handle, [1, 1]);
        this.stroke([b.pos, seg.h2], 0.12, COLORS.handle, [1, 1]);
        for (const hp of [seg.h1, seg.h2]) {
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, 1, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.handle;
          ctx.fill();
        }
      }
    }

    // Nodes.
    for (const node of this.net.nodes.values()) {
      ctx.beginPath();
      ctx.arc(node.pos.x, node.pos.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = node.id === opts.hoverNode ? COLORS.nodeHover : COLORS.node;
      ctx.fill();
    }
  }

  /** Small chevrons along each lane showing the direction of travel. */
  private drawLaneArrows(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.laneArrow;
    ctx.lineWidth = 0.18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const spacing = 11; // metres between chevrons
    for (const lane of this.net.graph.lanes) {
      const len = lane.poly.length;
      if (len < 4) continue;
      const size = 0.9;
      for (let s = spacing * 0.6; s < len; s += spacing) {
        const p = lane.poly.posAt(s);
        const d = lane.poly.dirAt(s);
        const back = scale(d, -size);
        const left = scale(perp(d), size * 0.7);
        const tip = add(p, scale(d, size * 0.4));
        const a = add(add(tip, back), left);
        const b = add(add(tip, back), scale(left, -1));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  /** Connector tool: show the hovered node's connectors and lane anchors. */
  private drawConnectMode(opts: RenderOptions): void {
    const ctx = this.ctx;

    // Existing connectors (the current turn movements).
    {
      for (const conn of this.net.graph.connectors) {
        const pts = conn.poly.points;
        this.stroke(pts, 0.4, COLORS.connector);
        // Arrowhead at the end to show direction.
        const end = pts[pts.length - 1];
        const d = normalize(sub(end, pts[pts.length - 2]));
        const back = scale(d, -1.2);
        const left = scale(perp(d), 0.7);
        ctx.beginPath();
        ctx.moveTo(end.x + back.x + left.x, end.y + back.y + left.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineTo(end.x + back.x - left.x, end.y + back.y - left.y);
        ctx.strokeStyle = COLORS.connector;
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
    }

    // Lane anchors: incoming (blue) and outgoing (green); selected one white.
    for (const a of opts.anchors) {
      const selected = a.kind === "in" && opts.linkFrom && sameLaneRef(a.ref, opts.linkFrom);
      ctx.beginPath();
      ctx.arc(a.pos.x, a.pos.y, selected ? 1.4 : 1.0, 0, Math.PI * 2);
      ctx.fillStyle = selected
        ? COLORS.anchorSel
        : a.kind === "in"
          ? COLORS.anchorIn
          : COLORS.anchorOut;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.12;
      ctx.stroke();
    }

    // Rubber-band from the selected incoming anchor to the cursor.
    if (opts.linkFrom && opts.cursorWorld) {
      const from = opts.anchors.find(
        (a) => a.kind === "in" && sameLaneRef(a.ref, opts.linkFrom!)
      );
      if (from) this.stroke([from.pos, opts.cursorWorld], 0.2, COLORS.anchorSel, [1, 1]);
    }
  }

  private drawConflicts(): void {
    const ctx = this.ctx;
    for (const conn of this.net.graph.connectors) {
      for (const c of conn.conflicts) {
        ctx.beginPath();
        ctx.arc(c.point.x, c.point.y, 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,80,80,0.6)";
        ctx.fill();
      }
    }
  }

  private drawVehicles(): void {
    const ctx = this.ctx;
    for (const v of this.sim.vehicles) {
      const p = v.pos();
      const ang = angleOf(v.dir());
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      const L = v.type.length;
      const W = v.type.width;
      ctx.fillStyle = v.type.color;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.1;
      roundRect(ctx, -L / 2, -W / 2, L, W, 0.5);
      ctx.fill();
      ctx.stroke();
      // Windshield hint toward the front.
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(L / 2 - L * 0.3, -W / 2 + 0.2, L * 0.18, W - 0.4);
      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
