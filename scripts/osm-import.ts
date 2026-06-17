import { writeFileSync } from "node:fs";
import { osmToNetwork, overpassUrl } from "../src/network/osm.ts";

/**
 * Download a real street layout from OpenStreetMap (via the Overpass API) and
 * write it as a SerializedNetwork JSON that the editor can import.
 *
 *   npm run osm -- <sur,oeste,norte,este> [salida.json]
 *
 * Example (a slice of Barcelona's Eixample):
 *   npm run osm -- 41.3840,2.1620,41.3905,2.1740 eixample.json
 *
 * Note: the Overpass host must be reachable. In sandboxed environments it may be
 * blocked by the network egress allow-list — run it locally, or import a zone
 * straight from the app's "Importar zona real (OSM)" button (runs in-browser).
 */
async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: npm run osm -- <sur,oeste,norte,este> [salida.json]");
    process.exit(1);
  }
  const bbox = arg.split(",").map((s) => parseFloat(s.trim()));
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    console.error("Bbox no válido. Formato: sur,oeste,norte,este (lat/lon).");
    process.exit(1);
  }
  const out = process.argv[3] ?? "osm-map.json";

  console.error(`Descargando vías de ${arg} …`);
  const res = await fetch(overpassUrl(bbox as [number, number, number, number]));
  if (!res.ok) {
    console.error(`Error de Overpass: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = await res.json();
  const net = osmToNetwork(data);
  writeFileSync(out, JSON.stringify(net));
  console.error(`Escrito ${out}: ${net.nodes.length} nodos, ${net.segments.length} segmentos.`);
  console.error('Cárgalo en el editor con "Importar".');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
