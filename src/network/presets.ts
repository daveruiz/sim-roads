import { RoadNetwork } from "./RoadNetwork.ts";
import { Vec2 } from "../core/vec.ts";
import { LaneRef } from "./types.ts";

export interface Preset {
  id: string;
  label: string;
  build: () => RoadNetwork;
}

/** Forward-lane reference helper for wiring manual connectors in presets. */
const FL = (segment: string, index = 0): LaneRef => ({ segment, dir: "forward", index });

/** Cross intersection: priority main road (N–S), STOP on the minor road (E–W). */
function intersection(): RoadNetwork {
  const net = new RoadNetwork();
  const c = net.addNode({ x: 0, y: 0 });
  const n = net.addNode({ x: 0, y: -75 });
  const s = net.addNode({ x: 0, y: 75 });
  const e = net.addNode({ x: 75, y: 0 });
  const w = net.addNode({ x: -75, y: 0 });
  net.addSegment(n.id, c.id);
  net.addSegment(c.id, s.id);
  const segE = net.addSegment(e.id, c.id);
  const segW = net.addSegment(w.id, c.id);
  net.setSign(segE.id, c.id, "stop");
  net.setSign(segW.id, c.id, "stop");
  return net;
}

/** T junction: through road priority, the stem road yields. */
function tJunction(): RoadNetwork {
  const net = new RoadNetwork();
  const c = net.addNode({ x: 0, y: 0 });
  const w = net.addNode({ x: -85, y: 0 });
  const e = net.addNode({ x: 85, y: 0 });
  const s = net.addNode({ x: 0, y: 80 });
  net.addSegment(w.id, c.id);
  net.addSegment(c.id, e.id);
  const stem = net.addSegment(s.id, c.id);
  net.setSign(stem.id, c.id, "yield");
  return net;
}

/** Four-way stop: every approach must stop and give way in turn. */
function allWayStop(): RoadNetwork {
  const net = new RoadNetwork();
  const c = net.addNode({ x: 0, y: 0 });
  const dirs: Vec2[] = [
    { x: 0, y: -75 },
    { x: 0, y: 75 },
    { x: 75, y: 0 },
    { x: -75, y: 0 },
  ];
  for (const d of dirs) {
    const ext = net.addNode(d);
    const seg = net.addSegment(ext.id, c.id);
    net.setSign(seg.id, c.id, "stop");
  }
  return net;
}

/** Single-lane roundabout with four entries/exits; entries yield to the ring. */
function roundabout(): RoadNetwork {
  const net = new RoadNetwork();
  const R = 40;
  const ringNodes: string[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ringNodes.push(net.addNode({ x: Math.cos(a) * R, y: Math.sin(a) * R }).id);
  }
  // One-way ring: each segment goes from node i to node i-1 (one step along the
  // short arc). Bézier handles bulge outward so the ring reads as a circle.
  const step = (Math.PI * 2) / count;
  const bulge = R / Math.cos(Math.PI / count);
  for (let i = 0; i < count; i++) {
    const from = ringNodes[i];
    const to = ringNodes[(i + count - 1) % count];
    const seg = net.addSegment(from, to, { lanesForward: 1, lanesBackward: 0 });
    const a0 = (i / count) * Math.PI * 2;
    const h1a = a0 - step * 0.33;
    const h2a = a0 - step * 0.66;
    net.updateSegment(seg.id, {
      h1: { x: Math.cos(h1a) * bulge, y: Math.sin(h1a) * bulge },
      h2: { x: Math.cos(h2a) * bulge, y: Math.sin(h2a) * bulge },
    });
  }
  for (let k = 0; k < 4; k++) {
    const idx = k * 2;
    const a = (idx / count) * Math.PI * 2;
    const ext: Vec2 = { x: Math.cos(a) * (R + 55), y: Math.sin(a) * (R + 55) };
    const extNode = net.addNode(ext);
    const entry = net.addSegment(extNode.id, ringNodes[idx], {
      lanesForward: 1,
      lanesBackward: 1,
    });
    net.setSign(entry.id, ringNodes[idx], "yield");
  }
  return net;
}

/** Highway with a yielding on-ramp merging into the right lane (lane discipline). */
function highwayMerge(): RoadNetwork {
  const net = new RoadNetwork();
  const a = net.addNode({ x: -160, y: 0 });
  const b = net.addNode({ x: 0, y: 0 });
  const c = net.addNode({ x: 160, y: 0 });
  const ab = net.addSegment(a.id, b.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 28 });
  const bc = net.addSegment(b.id, c.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 28 });
  const r = net.addNode({ x: -95, y: 58 });
  const ramp = net.addSegment(r.id, b.id, { lanesForward: 1, lanesBackward: 0, speedLimit: 18 });
  net.updateSegment(ramp.id, { h1: { x: -58, y: 52 }, h2: { x: -18, y: 12 } });
  net.setSign(ramp.id, b.id, "yield");
  // Lane discipline: main lanes go straight, the ramp merges into the right lane.
  net.toggleLink(b.id, FL(ab.id, 0), FL(bc.id, 0));
  net.toggleLink(b.id, FL(ab.id, 1), FL(bc.id, 1));
  net.toggleLink(b.id, FL(ramp.id, 0), FL(bc.id, 1));
  return net;
}

/** Highway with an off-ramp; the right lane may diverge to the exit. */
function highwayExit(): RoadNetwork {
  const net = new RoadNetwork();
  const a = net.addNode({ x: -160, y: 0 });
  const b = net.addNode({ x: 0, y: 0 });
  const c = net.addNode({ x: 160, y: 0 });
  const ab = net.addSegment(a.id, b.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 28 });
  const bc = net.addSegment(b.id, c.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 28 });
  const r = net.addNode({ x: 100, y: 60 });
  const ramp = net.addSegment(b.id, r.id, { lanesForward: 1, lanesBackward: 0, speedLimit: 18 });
  net.updateSegment(ramp.id, { h1: { x: 22, y: 6 }, h2: { x: 62, y: 48 } });
  // Lane discipline: through traffic stays in lane; the right lane can exit.
  net.toggleLink(b.id, FL(ab.id, 0), FL(bc.id, 0));
  net.toggleLink(b.id, FL(ab.id, 1), FL(bc.id, 1));
  net.toggleLink(b.id, FL(ab.id, 1), FL(ramp.id, 0));
  return net;
}

/** Winding two-lane road with smooth S-curves to exercise curve-speed behaviour. */
function sCurves(): RoadNetwork {
  const net = new RoadNetwork();
  const pts: Vec2[] = [
    { x: -180, y: 0 },
    { x: -90, y: -50 },
    { x: 0, y: 0 },
    { x: 90, y: 50 },
    { x: 180, y: 0 },
  ];
  const nodes = pts.map((p) => net.addNode(p).id);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const d = (p1.x - p0.x) / 2; // horizontal tangents -> smooth, flowing curves
    net.addSegment(nodes[i], nodes[i + 1], {
      speedLimit: 22,
      h1: { x: p0.x + d, y: p0.y },
      h2: { x: p1.x - d, y: p1.y },
    });
  }
  return net;
}

export const PRESETS: Preset[] = [
  { id: "intersection", label: "Intersección (STOP)", build: intersection },
  { id: "tjunction", label: "Cruce en T (ceda)", build: tJunction },
  { id: "allway", label: "STOP 4 direcciones", build: allWayStop },
  { id: "roundabout", label: "Rotonda", build: roundabout },
  { id: "merge", label: "Incorporación autovía", build: highwayMerge },
  { id: "exit", label: "Salida de autovía", build: highwayExit },
  { id: "scurves", label: "Carretera con curvas", build: sCurves },
];
