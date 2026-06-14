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

/**
 * Add a one-way circular roundabout centred at `c` with radius `R` and `count`
 * ring nodes, plus a two-way radial spoke at each angle in `spokeAngles`.
 * Returns the external node id of each spoke (to connect roads to). Entries
 * yield to the ring; the junction setback lets the merge be a clean turn.
 */
function addRoundabout(
  net: RoadNetwork,
  c: Vec2,
  R: number,
  count: number,
  spokeAngles: number[],
  spokeLen = 55
): string[] {
  const ring: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ring.push(net.addNode({ x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }).id);
  }
  const step = (Math.PI * 2) / count;
  const bulge = R / Math.cos(Math.PI / count);
  for (let i = 0; i < count; i++) {
    const seg = net.addSegment(ring[i], ring[(i + count - 1) % count], {
      lanesForward: 1,
      lanesBackward: 0,
    });
    const a0 = (i / count) * Math.PI * 2;
    net.updateSegment(seg.id, {
      h1: { x: c.x + Math.cos(a0 - step * 0.33) * bulge, y: c.y + Math.sin(a0 - step * 0.33) * bulge },
      h2: { x: c.x + Math.cos(a0 - step * 0.66) * bulge, y: c.y + Math.sin(a0 - step * 0.66) * bulge },
    });
  }
  const exts: string[] = [];
  for (const sa of spokeAngles) {
    const idx = ((Math.round(sa / step) % count) + count) % count;
    const ext = net.addNode({ x: c.x + Math.cos(sa) * (R + spokeLen), y: c.y + Math.sin(sa) * (R + spokeLen) });
    // Two-way radial spoke: forward lane enters, backward lane exits. The entry
    // approaches radially (not alongside the ring) so it doesn't overlap
    // circulating traffic, and yields.
    const spoke = net.addSegment(ext.id, ring[idx], { lanesForward: 1, lanesBackward: 1, speedLimit: 12 });
    net.setSign(spoke.id, ring[idx], "yield");
    exts.push(ext.id);
  }
  return exts;
}

/** Single-lane roundabout with four entries/exits; entries yield to the ring. */
function roundabout(): RoadNetwork {
  const net = new RoadNetwork();
  addRoundabout(net, { x: 0, y: 0 }, 46, 20, [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
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
