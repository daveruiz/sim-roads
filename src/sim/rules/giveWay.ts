import { BehaviorRule } from "./types.ts";
import { followAccel } from "./idm.ts";

const REQUIRED_GAP = 3.2; // s — minimum acceptable gap to a priority vehicle
const STOP_SPEED = 0.5; // m/s — counts as "stopped" at a STOP line
const STOP_ZONE = 3.0; // m — distance within which a STOP is registered

/**
 * Right-of-way at yield/stop controlled connectors. The vehicle brakes to the
 * stop line and only proceeds when the crossing is clear (gap acceptance). A
 * STOP additionally requires a full halt at the line before going.
 */
export const giveWayRule: BehaviorRule = {
  id: "give-way",
  label: "Ceda el paso / STOP",
  description: "Cede la prioridad en intersecciones según señales (gap acceptance).",
  enabled: true,
  evaluate(ctx) {
    const veh = ctx.vehicle;
    const ahead = ctx.control;
    if (!ahead) {
      veh.clearedControl = null;
      return null;
    }
    const conn = ahead.connector;
    if (veh.clearedControl === conn.id) return null; // already committed through

    const { minTimeGap, blocked } = ctx.isCrossingClear(conn);
    let mustStop = blocked || minTimeGap < REQUIRED_GAP;

    if (conn.control === "stop") {
      const stoppedAtLine = veh.speed < STOP_SPEED && ahead.distance < STOP_ZONE;
      if (!stoppedAtLine) mustStop = true;
    }

    if (!mustStop) {
      veh.clearedControl = conn.id; // commit; don't re-evaluate mid-crossing
      return null;
    }

    // Brake smoothly to the stop line (a virtual stationary obstacle).
    return followAccel(veh.speed, ctx.desiredSpeed, ahead.distance, 0, veh.type);
  },
};
