import { Vec2, normalize, sub, dist, add, scale } from "./vec.ts";

/**
 * A polyline with a cumulative arc-length table so we can query a position and
 * a unit tangent at any distance `s` along it. This is the geometric backbone
 * every vehicle travels on — both road lanes and intersection connectors are
 * represented as polylines.
 */
export class Polyline {
  readonly points: Vec2[];
  readonly cum: number[]; // cumulative length at each point
  readonly length: number;

  constructor(points: Vec2[]) {
    if (points.length < 2) {
      // Degenerate guard: duplicate the single point so queries are safe.
      points = points.length === 1 ? [points[0], points[0]] : [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ];
    }
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1] + dist(points[i], points[i - 1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /** Position at arc length s (clamped to [0, length]). */
  posAt(s: number): Vec2 {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.segmentIndexAt(s);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen < 1e-9 ? 0 : (s - this.cum[i]) / segLen;
    return add(this.points[i], scale(sub(this.points[i + 1], this.points[i]), t));
  }

  /** Unit tangent (direction of travel) at arc length s. */
  dirAt(s: number): Vec2 {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.segmentIndexAt(s);
    return normalize(sub(this.points[i + 1], this.points[i]));
  }

  private segmentIndexAt(s: number): number {
    // Linear scan is fine for the modest point counts we use here.
    for (let i = 1; i < this.cum.length; i++) {
      if (s <= this.cum[i]) return i - 1;
    }
    return this.points.length - 2;
  }
}
