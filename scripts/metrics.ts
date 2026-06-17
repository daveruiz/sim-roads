import { PRESETS } from "../src/network/presets.ts";
import { Simulation } from "../src/sim/Simulation.ts";

/** Oriented-bounding-box overlap test between two vehicles (SAT). */
function overlap(a: any, b: any): boolean {
  const pa = a.pos(), pb = b.pos();
  if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 12) return false;
  const da = a.dir(), db = b.dir();
  const ax = { x: da.x, y: da.y }, ay = { x: -da.y, y: da.x };
  const bx = { x: db.x, y: db.y }, by = { x: -db.y, y: db.x };
  const ahl = a.type.length / 2, ahw = a.type.width / 2;
  const bhl = b.type.length / 2, bhw = b.type.width / 2;
  const d = { x: pb.x - pa.x, y: pb.y - pa.y };
  const axes = [ax, ay, bx, by];
  for (const L of axes) {
    const paProj = ahl * Math.abs(ax.x * L.x + ax.y * L.y) + ahw * Math.abs(ay.x * L.x + ay.y * L.y);
    const pbProj = bhl * Math.abs(bx.x * L.x + bx.y * L.y) + bhw * Math.abs(by.x * L.x + by.y * L.y);
    const dProj = Math.abs(d.x * L.x + d.y * L.y);
    if (dProj > paProj + pbProj + 0.05) return false; // separating axis (5cm slack)
  }
  return true;
}

/** Seedable PRNG so runs are reproducible across configs. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = [1, 2, 3];

function run(preset: any, disc: number, seed: number) {
  const rng = mulberry32(seed);
  const orig = Math.random;
  (Math as any).random = rng;
  try {
    const net = preset.build();
    const sim = new Simulation(net);
    sim.config.spawnRate = 1.2;
    sim.config.freedom = disc;
    const ringSegs = new Set<string>();
    for (const s of net.segments.values()) if ((s as any).laneFlip) ringSegs.add(s.id);
    let ringInner = 0, ringTotal = 0;
    let overlapTicks = 0, sampleTicks = 0, overtakeSeen = 0, offLaneTicks = 0, vehTicks = 0, arrived = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      sim.step(0.04);
      if (i % 5 === 0) {
        sampleTicks++;
        const vs = sim.vehicles;
        for (const v of vs) {
          vehTicks++;
          if ((v as any).offsetLane) offLaneTicks++;
          if ((v as any).offsetLane && !seen.has(v.id)) { seen.add(v.id); overtakeSeen++; }
          const cur: any = v.current;
          if (cur && ringSegs.has(cur.segment)) { ringTotal++; if (cur.interiorness > 0) ringInner++; }
        }
        for (let a = 0; a < vs.length; a++)
          for (let b = a + 1; b < vs.length; b++)
            if (overlap(vs[a], vs[b])) overlapTicks++;
      }
    }
    arrived = sim.stats.arrived;
    return {
      overlap: overlapTicks / sampleTicks,
      overtakeSeen,
      offPct: (100 * offLaneTicks) / Math.max(vehTicks, 1),
      ringInnerPct: ringTotal ? (100 * ringInner) / ringTotal : -1,
      arrived,
    };
  } finally {
    (Math as any).random = orig;
  }
}

for (const disc of [1, 0.5, 0]) {
  console.log(`\n=== freedom = ${disc} (mean of ${SEEDS.length} seeds) ===`);
  for (const preset of PRESETS) {
    let ov = 0, ot = 0, off = 0, arr = 0, ring = 0;
    for (const s of SEEDS) {
      const r = run(preset, disc, s);
      ov += r.overlap; ot += r.overtakeSeen; off += r.offPct; arr += r.arrived; ring += r.ringInnerPct;
    }
    const n = SEEDS.length;
    const ringStr = ring / n >= 0 ? ` ringInner%=${(ring / n).toFixed(0)}` : "";
    console.log(
      `${preset.label.padEnd(26)} overlaps/tick=${(ov / n).toFixed(2)} ` +
        `overtakes=${(ot / n).toFixed(0)} arrived=${(arr / n).toFixed(0)}${ringStr}`
    );
  }
}
