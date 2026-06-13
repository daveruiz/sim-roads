import { Vec2, sub, normalize } from "./vec.ts";

/**
 * Cubic Bézier helpers. A segment's centerline is a cubic Bézier with
 * endpoints p0/p3 (the nodes) and control points p1/p2 (the curve handles).
 * A straight segment simply uses control points at 1/3 and 2/3 of the chord.
 */
export interface Cubic {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export function cubicAt(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

/** First derivative (tangent, not normalized). */
export function cubicTangent(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return {
    x: a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x),
    y: a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y),
  };
}

/** Default straight-line control points for a chord p0..p3. */
export function straightControls(p0: Vec2, p3: Vec2): { p1: Vec2; p2: Vec2 } {
  return {
    p1: { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
    p2: { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 },
  };
}

/**
 * Sample a cubic into a polyline of N+1 points plus per-point unit tangents.
 * N is chosen from an approximate length so curves stay smooth.
 */
export function samplePolyline(c: Cubic): { points: Vec2[]; tangents: Vec2[] } {
  // Rough length estimate from the control polygon.
  const approx =
    Math.hypot(c.p1.x - c.p0.x, c.p1.y - c.p0.y) +
    Math.hypot(c.p2.x - c.p1.x, c.p2.y - c.p1.y) +
    Math.hypot(c.p3.x - c.p2.x, c.p3.y - c.p2.y);
  const n = Math.max(8, Math.min(120, Math.round(approx / 6)));
  const points: Vec2[] = [];
  const tangents: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push(cubicAt(c, t));
    tangents.push(normalize(cubicTangent(c, t)));
  }
  return { points, tangents };
}

/** Polyline arc length. */
export function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Unit tangent at the start of a cubic (handles degenerate handles). */
export function startDir(c: Cubic): Vec2 {
  let d = cubicTangent(c, 0);
  if (Math.hypot(d.x, d.y) < 1e-6) d = sub(c.p3, c.p0);
  return normalize(d);
}
