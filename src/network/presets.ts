import { RoadNetwork } from "./RoadNetwork.ts";
import { Vec2 } from "../core/vec.ts";
import { LaneRef } from "./types.ts";

export interface Preset {
  id: string;
  label: string;
  build: () => RoadNetwork;
}

/** Forward / backward lane reference helpers for wiring manual connectors. */
const FL = (segment: string, index = 0): LaneRef => ({ segment, dir: "forward", index });
const BL = (segment: string, index = 0): LaneRef => ({ segment, dir: "backward", index });

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
 * ring nodes (one-way, `ringLanes` concentric lanes), plus a two-way radial
 * spoke at each angle in `spokeAngles`. Returns the external node id of each
 * spoke (to connect roads to).
 *
 * Lane discipline is wired with manual connectors so that:
 *  - circulating traffic stays in its lane (no weaving between ring lanes);
 *  - each entry can feed any ring lane and any ring lane can reach each exit
 *    (so all lanes are used without modelling lane changes);
 *  - entries yield to the ring.
 */
function addRoundabout(
  net: RoadNetwork,
  c: Vec2,
  R: number,
  count: number,
  spokeAngles: number[],
  spokeLen = 55,
  ringLanes = 1
): string[] {
  const ring: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ring.push(net.addNode({ x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }).id);
  }
  const step = (Math.PI * 2) / count;
  const bulge = R / Math.cos(Math.PI / count);
  const ringSeg: string[] = [];
  for (let i = 0; i < count; i++) {
    // Ring travels node i -> node i-1 (drive-on-right circulation sense), but
    // laneFlip puts its lanes/asphalt INSIDE the circle, so the ring nodes lie
    // on the OUTER edge where the spokes join.
    const seg = net.addSegment(ring[i], ring[(i + count - 1) % count], {
      lanesForward: ringLanes,
      lanesBackward: 0,
      laneFlip: true,
    });
    const a0 = (i / count) * Math.PI * 2;
    net.updateSegment(seg.id, {
      h1: { x: c.x + Math.cos(a0 - step * 0.33) * bulge, y: c.y + Math.sin(a0 - step * 0.33) * bulge },
      h2: { x: c.x + Math.cos(a0 - step * 0.66) * bulge, y: c.y + Math.sin(a0 - step * 0.66) * bulge },
    });
    ringSeg.push(seg.id); // ringSeg[i] runs node i -> node i-1
  }
  // Lane-preserving through movements at every ring node (inSeg ends at the
  // node, outSeg leaves it).
  for (let n = 0; n < count; n++) {
    const inSeg = ringSeg[(n + 1) % count];
    const outSeg = ringSeg[n];
    for (let i = 0; i < ringLanes; i++) net.toggleLink(ring[n], FL(inSeg, i), FL(outSeg, i));
  }

  const exts: string[] = [];
  for (const sa of spokeAngles) {
    const idx = ((Math.round(sa / step) % count) + count) % count;
    const ext = net.addNode({ x: c.x + Math.cos(sa) * (R + spokeLen), y: c.y + Math.sin(sa) * (R + spokeLen) });
    // Two-way radial spoke: forward lane enters, backward lane exits. Radial
    // approach (not alongside the ring) avoids overlapping circulating traffic.
    const spoke = net.addSegment(ext.id, ring[idx], { lanesForward: 1, lanesBackward: 1, speedLimit: 12 });
    net.setSign(spoke.id, ring[idx], "yield");
    const inSeg = ringSeg[(idx + 1) % count];
    const outSeg = ringSeg[idx];
    for (let i = 0; i < ringLanes; i++) {
      net.toggleLink(ring[idx], FL(spoke.id, 0), FL(outSeg, i)); // enter into any lane
      net.toggleLink(ring[idx], FL(inSeg, i), BL(spoke.id, 0)); // exit from any lane
    }
    exts.push(ext.id);
  }
  return exts;
}

/** Two-lane roundabout with four entries/exits; entries yield to the ring. */
function roundabout(): RoadNetwork {
  const net = new RoadNetwork();
  addRoundabout(net, { x: 0, y: 0 }, 48, 20, [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2], 55, 2);
  return net;
}

/** Highway with a yielding on-ramp merging into the right lane (lane discipline). */
function highwayMerge(): RoadNetwork {
  const net = new RoadNetwork();
  const a = net.addNode({ x: -160, y: 0 });
  const b = net.addNode({ x: 0, y: 0 });
  const c = net.addNode({ x: 160, y: 0 });
  const ab = net.addSegment(a.id, b.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });
  const bc = net.addSegment(b.id, c.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });
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
  const ab = net.addSegment(a.id, b.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });
  const bc = net.addSegment(b.id, c.id, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });
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

/** Two-way road helper; optional sign on the approach to `b`. */
function road(net: RoadNetwork, a: string, b: string, opts?: Parameters<RoadNetwork["addSegment"]>[2]) {
  return net.addSegment(a, b, { lanesForward: 1, lanesBackward: 1, ...opts });
}

/**
 * A larger interconnected map: a roundabout feeding a priority cross
 * intersection, plus a two-lane motorway with an on-ramp (merge) and an
 * off-ramp (exit). Multiple entry/exit terminals create rich, mixed traffic.
 */
function cityMap(): RoadNetwork {
  const net = new RoadNetwork();

  // Three-lane roundabout with four spokes (E, S, W, N external nodes).
  const [extE, extS, extW, extN] = addRoundabout(
    net,
    { x: -170, y: 0 },
    44,
    24,
    [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    50,
    3
  );

  // Terminals hanging off three of the spokes.
  road(net, net.addNode({ x: -330, y: 0 }).id, extW);
  road(net, net.addNode({ x: -150, y: -180 }).id, extN);
  road(net, net.addNode({ x: -150, y: 180 }).id, extS);

  // Main road from the roundabout to a cross intersection.
  const xc = net.addNode({ x: 70, y: 0 }).id;
  road(net, extE, xc);

  // Cross intersection: priority E–W, the north arm yields with a STOP.
  const txe = net.addNode({ x: 220, y: 0 }).id;
  road(net, xc, txe);
  const txn = net.addNode({ x: 70, y: -140 }).id;
  const nArm = road(net, txn, xc);
  net.setSign(nArm.id, xc, "stop");

  // Two-lane one-way motorway with a merging on-ramp and a diverging off-ramp.
  const hwW = net.addNode({ x: -340, y: 170 }).id;
  const hwM = net.addNode({ x: 70, y: 170 }).id;
  const hwE = net.addNode({ x: 360, y: 170 }).id;
  const ab = net.addSegment(hwW, hwM, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });
  const bc = net.addSegment(hwM, hwE, { lanesForward: 2, lanesBackward: 0, speedLimit: 24 });

  // On-ramp: the intersection's south arm slips down onto the motorway.
  const ramp = net.addSegment(xc, hwM, { lanesForward: 1, lanesBackward: 0, speedLimit: 16 });
  net.updateSegment(ramp.id, { h1: { x: 70, y: 70 }, h2: { x: 52, y: 158 } });
  net.setSign(ramp.id, hwM, "yield");

  // Off-ramp: the right lane may exit to a terminal.
  const hwOf = net.addNode({ x: 220, y: 270 }).id;
  const off = net.addSegment(hwM, hwOf, { lanesForward: 1, lanesBackward: 0, speedLimit: 16 });
  net.updateSegment(off.id, { h1: { x: 100, y: 184 }, h2: { x: 185, y: 240 } });

  // Lane discipline at the motorway junction.
  net.toggleLink(hwM, FL(ab.id, 0), FL(bc.id, 0));
  net.toggleLink(hwM, FL(ab.id, 1), FL(bc.id, 1));
  net.toggleLink(hwM, FL(ab.id, 1), FL(off.id, 0));
  net.toggleLink(hwM, FL(ramp.id, 0), FL(bc.id, 1));

  return net;
}

/* ------------------------------------------------------------------ *
 * PROCEDURAL CITY GENERATOR
 * A jittered grid of "hubs" (priority cross intersections and multi-lane
 * roundabouts) joined by arterial roads. Unconnected hub ports become edge
 * terminals (traffic sources/sinks). Deterministic given a seed.
 * ------------------------------------------------------------------ */

/** The four connectable ports (node ids) of a hub. */
interface Ports {
  N: string;
  E: string;
  S: string;
  W: string;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cross intersection hub: four arms, one axis given priority over the other. */
function crossHub(net: RoadNetwork, cx: number, cy: number, rng: () => number): Ports {
  const arm = 40;
  const c = net.addNode({ x: cx, y: cy }).id;
  const N = net.addNode({ x: cx, y: cy - arm }).id;
  const S = net.addNode({ x: cx, y: cy + arm }).id;
  const E = net.addNode({ x: cx + arm, y: cy }).id;
  const W = net.addNode({ x: cx - arm, y: cy }).id;
  const sN = net.addSegment(N, c);
  const sS = net.addSegment(S, c);
  const sE = net.addSegment(E, c);
  const sW = net.addSegment(W, c);
  const sign = rng() < 0.5 ? "stop" : "yield";
  if (rng() < 0.5) {
    net.setSign(sN.id, c, sign);
    net.setSign(sS.id, c, sign);
  } else {
    net.setSign(sE.id, c, sign);
    net.setSign(sW.id, c, sign);
  }
  return { N, E, S, W };
}

/** Roundabout hub (2 or 3 lanes) with four spokes mapped to N/E/S/W ports. */
function roundaboutHub(net: RoadNetwork, cx: number, cy: number, rng: () => number): Ports {
  const lanes = rng() < 0.5 ? 2 : 3;
  const exts = addRoundabout(
    net,
    { x: cx, y: cy },
    30,
    18,
    [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    30,
    lanes
  );
  return { E: exts[0], S: exts[1], W: exts[2], N: exts[3] };
}

/** Generate a city of `cols`×`rows` hubs joined by arterials (seeded). */
function generateCity(cols: number, rows: number, seed: number, spacing = 240): RoadNetwork {
  const net = new RoadNetwork();
  const rng = mulberry32(seed);
  const grid: Ports[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Ports[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (c - (cols - 1) / 2) * spacing + (rng() - 0.5) * 50;
      const cy = (r - (rows - 1) / 2) * spacing + (rng() - 0.5) * 50;
      row.push(rng() < 0.28 ? roundaboutHub(net, cx, cy, rng) : crossHub(net, cx, cy, rng));
    }
    grid.push(row);
  }
  // Arterials to the right and bottom neighbours (occasionally skipped so the
  // network isn't a perfect grid). Unconnected ports stay as edge terminals.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && rng() > 0.12) net.addSegment(grid[r][c].E, grid[r][c + 1].W);
      if (r + 1 < rows && rng() > 0.12) net.addSegment(grid[r][c].S, grid[r + 1][c].N);
    }
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
  { id: "city", label: "Ciudad (mapa grande)", build: cityMap },
  { id: "metropolis", label: "Metrópolis (generada)", build: () => generateCity(5, 4, 7) },
];
