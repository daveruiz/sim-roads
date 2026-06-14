/** Static parameters shared by all vehicles of a given kind. */
export interface VehicleType {
  id: string;
  label: string;
  length: number; // metres
  width: number;
  maxSpeed: number; // m/s
  maxAccel: number; // m/s^2 (comfortable acceleration)
  maxDecel: number; // m/s^2 (comfortable braking)
  color: string;
  /** Relative spawn weight when mixing traffic. */
  weight: number;
}

export const VEHICLE_TYPES: VehicleType[] = [
  {
    id: "car",
    label: "Coche",
    length: 4.5,
    width: 1.9,
    maxSpeed: 38, // ~137 km/h
    maxAccel: 2.6,
    maxDecel: 4.5,
    color: "#4fa8ff",
    weight: 6,
  },
  {
    id: "van",
    label: "Furgoneta",
    length: 6,
    width: 2.1,
    maxSpeed: 33,
    maxAccel: 1.8,
    maxDecel: 4.0,
    color: "#ffd24f",
    weight: 2,
  },
  {
    id: "truck",
    label: "Camión",
    length: 8.5,
    width: 2.5,
    maxSpeed: 25,
    maxAccel: 1.0,
    maxDecel: 3.5,
    color: "#ff7a4f",
    weight: 1,
  },
  {
    id: "bus",
    label: "Autobús",
    length: 9,
    width: 2.55,
    maxSpeed: 27,
    maxAccel: 1.2,
    maxDecel: 3.8,
    color: "#7CFC9A",
    weight: 1,
  },
];

export function pickVehicleType(enabled: Set<string>, rng: () => number): VehicleType {
  const pool = VEHICLE_TYPES.filter((t) => enabled.has(t.id));
  const types = pool.length ? pool : VEHICLE_TYPES;
  const total = types.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of types) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return types[types.length - 1];
}
