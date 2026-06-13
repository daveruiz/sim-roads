import { RoadNetwork } from "./RoadNetwork.ts";
import { Vec2 } from "../core/vec.ts";

export interface Preset {
  id: string;
  label: string;
  build: () => RoadNetwork;
}

/** Cross intersection: priority main road (N–S), STOP on the minor road (E–W). */
function intersection(): RoadNetwork {
  const net = new RoadNetwork();
  const c = net.addNode({ x: 0, y: 0 });
  const n = net.addNode({ x: 0, y: -70 });
  const s = net.addNode({ x: 0, y: 70 });
  const e = net.addNode({ x: 70, y: 0 });
  const w = net.addNode({ x: -70, y: 0 });
  net.addSegment(n.id, c.id);
  net.addSegment(c.id, s.id);
  const segE = net.addSegment(e.id, c.id);
  const segW = net.addSegment(w.id, c.id);
  // Minor road yields to the main road.
  net.setSign(segE.id, c.id, "stop");
  net.setSign(segW.id, c.id, "stop");
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
    const a0 = (i / count) * Math.PI * 2; // angle of node i
    const h1a = a0 - step * 0.33; // along the short arc toward node i-1
    const h2a = a0 - step * 0.66;
    net.updateSegment(seg.id, {
      h1: { x: Math.cos(h1a) * bulge, y: Math.sin(h1a) * bulge },
      h2: { x: Math.cos(h2a) * bulge, y: Math.sin(h2a) * bulge },
    });
  }
  // Four entry/exit roads on alternating ring nodes.
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

/** Highway with a yielding on-ramp merging into the right lane. */
function highwayMerge(): RoadNetwork {
  const net = new RoadNetwork();
  const a = net.addNode({ x: -150, y: 0 });
  const b = net.addNode({ x: 0, y: 0 });
  const c = net.addNode({ x: 150, y: 0 });
  net.addSegment(a.id, b.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 27 });
  net.addSegment(b.id, c.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 27 });
  // On-ramp curving in from the south-west.
  const r = net.addNode({ x: -90, y: 55 });
  const ramp = net.addSegment(r.id, b.id, {
    lanesForward: 1,
    lanesBackward: 0,
    speedLimit: 18,
  });
  net.updateSegment(ramp.id, {
    h1: { x: -55, y: 50 },
    h2: { x: -18, y: 12 },
  });
  net.setSign(ramp.id, b.id, "yield");
  return net;
}

export const PRESETS: Preset[] = [
  { id: "intersection", label: "Intersección (STOP)", build: intersection },
  { id: "roundabout", label: "Rotonda", build: roundabout },
  { id: "merge", label: "Incorporación autovía", build: highwayMerge },
];
