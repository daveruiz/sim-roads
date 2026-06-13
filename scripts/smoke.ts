import { PRESETS } from "../src/network/presets.ts";
import { Simulation } from "../src/sim/Simulation.ts";

for (const preset of PRESETS) {
  const net = preset.build();
  const g = net.graph;
  const sim = new Simulation(net);
  sim.config.spawnRate = 3;

  let maxVehicles = 0;
  let maxSpeed = 0;
  for (let i = 0; i < 4000; i++) {
    sim.step(0.04);
    maxVehicles = Math.max(maxVehicles, sim.vehicles.length);
    for (const v of sim.vehicles) maxSpeed = Math.max(maxSpeed, v.speed);
    for (const v of sim.vehicles) {
      if (!Number.isFinite(v.s) || !Number.isFinite(v.speed)) {
        throw new Error(`Non-finite vehicle state in ${preset.id}`);
      }
    }
  }

  console.log(
    `${preset.label.padEnd(26)} lanes=${g.lanes.length} conns=${g.connectors.length} ` +
      `sources=${g.sources.length} sinks=${g.sinks.size} | ` +
      `spawned=${sim.stats.spawned} arrived=${sim.stats.arrived} ` +
      `peak=${maxVehicles} maxSpeed=${(maxSpeed * 3.6).toFixed(0)}km/h`
  );

  if (sim.stats.spawned === 0) throw new Error(`No vehicles spawned in ${preset.id}`);
  if (sim.stats.arrived === 0) throw new Error(`No vehicles arrived in ${preset.id}`);
}

console.log("smoke OK");
