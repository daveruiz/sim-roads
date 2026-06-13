let counter = 1;

/** Monotonic id generator, prefixed by kind for readability when debugging. */
export function nextId(prefix = "id"): string {
  return `${prefix}_${counter++}`;
}
