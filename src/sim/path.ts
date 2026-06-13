import { Lane, Connector } from "../network/types.ts";
import { Polyline } from "../core/polyline.ts";

/** A vehicle travels along a sequence of path elements: lanes and connectors. */
export type PathEl = Lane | Connector;

export function isConnector(el: PathEl): el is Connector {
  return (el as Connector).control !== undefined;
}

export function isLane(el: PathEl): el is Lane {
  return !isConnector(el);
}

export function elementId(el: PathEl): string {
  return el.id;
}

export function elementPoly(el: PathEl): Polyline {
  return el.poly;
}
