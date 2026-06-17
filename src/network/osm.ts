import { Vec2 } from "../core/vec.ts";
import { straightControls } from "../core/bezier.ts";
import { nextId } from "../core/id.ts";
import { RoadNode, Segment } from "./types.ts";
import { SerializedNetwork } from "./RoadNetwork.ts";

/* ------------------------------------------------------------------ *
 * OpenStreetMap import
 * Convert raw OSM data (as returned by the Overpass API) into our editable
 * RoadNetwork model: highway `way`s become chains of straight Segments joined
 * at shared intersection nodes, with lanes / one-way / speed read from tags.
 * Pure and side-effect free, so it runs the same in the browser and in Node.
 * ------------------------------------------------------------------ */

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OsmData {
  elements: OsmElement[];
}

/** Default lanes (per direction) and speed (m/s) by highway class. */
const ROAD_DEFAULTS: Record<string, { lanes: number; speed: number }> = {
  motorway: { lanes: 2, speed: 31 },
  motorway_link: { lanes: 1, speed: 18 },
  trunk: { lanes: 2, speed: 25 },
  trunk_link: { lanes: 1, speed: 16 },
  primary: { lanes: 2, speed: 18 },
  primary_link: { lanes: 1, speed: 12 },
  secondary: { lanes: 1, speed: 16 },
  secondary_link: { lanes: 1, speed: 12 },
  tertiary: { lanes: 1, speed: 14 },
  tertiary_link: { lanes: 1, speed: 10 },
  residential: { lanes: 1, speed: 9 },
  living_street: { lanes: 1, speed: 6 },
  unclassified: { lanes: 1, speed: 11 },
  road: { lanes: 1, speed: 11 },
};

/** Highway classes that carry general motor traffic and are worth importing. */
export const DRIVABLE = new Set(Object.keys(ROAD_DEFAULTS));

const EARTH_R = 6378137; // m

export interface OsmImportOptions {
  /** Douglas–Peucker tolerance (m) for simplifying way geometry. */
  tolerance?: number;
  /** Only import these highway classes (defaults to all drivable ones). */
  classes?: Set<string>;
}

/** Build the Overpass QL query string for a bounding box (south,west,north,east). */
export function overpassQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  const filter = [...DRIVABLE].join("|");
  return (
    `[out:json][timeout:60];` +
    `(way["highway"~"^(${filter})$"](${s},${w},${n},${e}););` +
    `(._;>;);out body;`
  );
}

/** Full Overpass API endpoint URL with the query for `bbox` baked in. */
export function overpassUrl(bbox: [number, number, number, number]): string {
  return "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(overpassQuery(bbox));
}

/**
 * Convert OSM data into a serialized RoadNetwork. Coordinates are projected to
 * a local metric frame (equirectangular about the data's centre, y pointing
 * down to match screen space) and centred on the origin.
 */
export function osmToNetwork(data: OsmData, opts: OsmImportOptions = {}): SerializedNetwork {
  const tolerance = opts.tolerance ?? 4;
  const classes = opts.classes ?? DRIVABLE;

  const coords = new Map<number, { lat: number; lon: number }>();
  const ways: OsmElement[] = [];
  for (const el of data.elements) {
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      coords.set(el.id, { lat: el.lat, lon: el.lon });
    } else if (el.type === "way" && el.nodes && classes.has(el.tags?.highway ?? "")) {
      ways.push(el);
    }
  }

  // Count how many kept ways touch each node: those used by >1 way (or at a
  // way's ends) are real intersections and must be shared between segments.
  const usage = new Map<number, number>();
  for (const way of ways) {
    for (const nid of way.nodes!) usage.set(nid, (usage.get(nid) ?? 0) + 1);
  }

  // Projection centre = mean of all used coordinates.
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (const way of ways) {
    for (const nid of way.nodes!) {
      const c = coords.get(nid);
      if (c) {
        sumLat += c.lat;
        sumLon += c.lon;
        count++;
      }
    }
  }
  if (count === 0) return { nodes: [], segments: [], signs: [] };
  const lat0 = sumLat / count;
  const lon0 = sumLon / count;
  const kx = (Math.PI / 180) * EARTH_R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * EARTH_R;
  const project = (c: { lat: number; lon: number }): Vec2 => ({
    x: (c.lon - lon0) * kx,
    y: -(c.lat - lat0) * ky, // screen y points down
  });

  const outNodes: RoadNode[] = [];
  const outSegments: Segment[] = [];
  const sharedNode = new Map<number, string>(); // osm node id -> RoadNode id

  const addNode = (pos: Vec2): string => {
    const node: RoadNode = { id: nextId("node"), pos };
    outNodes.push(node);
    return node.id;
  };
  const sharedNodeId = (osmId: number): string => {
    let id = sharedNode.get(osmId);
    if (!id) {
      id = addNode(project(coords.get(osmId)!));
      sharedNode.set(osmId, id);
    }
    return id;
  };

  for (const way of ways) {
    const tags = way.tags ?? {};
    const lanes = laneSpec(tags);
    const speed = parseSpeed(tags, ROAD_DEFAULTS[tags.highway ?? ""]?.speed ?? 11);
    const ids = way.nodes!.filter((nid) => coords.has(nid));
    if (ids.length < 2) continue;

    // Split the way at intersection nodes into edges between two junctions.
    let from = 0;
    for (let i = 1; i < ids.length; i++) {
      const isJunction = (usage.get(ids[i]) ?? 0) > 1;
      if (i < ids.length - 1 && !isJunction) continue;

      // Simplify the geometry of this edge, then chain straight segments along it.
      const pts = ids.slice(from, i + 1).map((nid) => project(coords.get(nid)!));
      const keep = simplify(pts, tolerance); // indices into pts, includes 0 and last
      let prevNodeId = sharedNodeId(ids[from]);
      let prevPos = pts[0];
      for (let k = 1; k < keep.length; k++) {
        const idx = keep[k];
        const last = k === keep.length - 1;
        const pos = pts[idx];
        const nodeId = last ? sharedNodeId(ids[i]) : addNode(pos);
        outSegments.push(makeSegment(prevNodeId, nodeId, prevPos, pos, lanes, speed));
        prevNodeId = nodeId;
        prevPos = pos;
      }
      from = i;
    }
  }

  return { nodes: outNodes, segments: outSegments, signs: [] };
}

/** lanes / direction from a way's tags. */
function laneSpec(tags: Record<string, string>): { forward: number; backward: number } {
  const def = ROAD_DEFAULTS[tags.highway ?? ""]?.lanes ?? 1;
  const oneway = tags.oneway === "yes" || tags.oneway === "true" || tags.oneway === "1" || tags.junction === "roundabout";
  const reverse = tags.oneway === "-1" || tags.oneway === "reverse";
  const total = parseInt(tags.lanes ?? "", 10);

  if (oneway) {
    return { forward: Number.isFinite(total) ? Math.max(1, total) : def, backward: 0 };
  }
  if (reverse) {
    return { forward: 0, backward: Number.isFinite(total) ? Math.max(1, total) : def };
  }
  const each = Number.isFinite(total) ? Math.max(1, Math.round(total / 2)) : def;
  return { forward: each, backward: each };
}

/** Parse an OSM maxspeed tag to m/s, falling back to `fallback`. */
function parseSpeed(tags: Record<string, string>, fallback: number): number {
  const raw = tags.maxspeed;
  if (!raw) return fallback;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  return /mph/i.test(raw) ? n * 0.44704 : n * 0.27778; // default km/h
}

function makeSegment(
  startNode: string,
  endNode: string,
  a: Vec2,
  b: Vec2,
  lanes: { forward: number; backward: number },
  speed: number
): Segment {
  const { p1, p2 } = straightControls(a, b);
  return {
    id: nextId("seg"),
    startNode,
    endNode,
    h1: p1,
    h2: p2,
    lanesForward: lanes.forward,
    lanesBackward: lanes.backward,
    laneWidth: 3.4,
    speedLimit: speed,
  };
}

/**
 * Douglas–Peucker line simplification. Returns the kept indices into `pts`
 * (always including the first and last), so the caller can drop redundant shape
 * points while preserving the junction endpoints.
 */
function simplify(pts: Vec2[], tol: number): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(pts[i], pts[lo], pts[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}
