import { hud, pauseLabel, shortLabel } from "../lib/displays";
import { isStale, status } from "../lib/helper";

/**
 * Reports the XDR brightness boost for each connected XDR display: its id (pass it to set-boost when two
 * displays share a name), its level (1.0 = off … 1.75 = maximum),
 * the level's name, and its status (off, boosted, limited by the panel's headroom, waiting for EDR, or EDR unavailable).
 */
export default async function tool() {
  const now = await status();
  if (isStale(now)) {
    // Don't report an older build's unreadable state as "off".
    return {
      summary: "An older XDR Boost helper is running; its levels can't be read. Changing the boost replaces it.",
    };
  }
  return {
    summary: hud(now),
    ...(pauseLabel(now) ? { paused: pauseLabel(now) } : {}),
    displays: now.displays.map((d) => ({
      id: d.uuid,
      name: d.name,
      level: d.level,
      levelName: shortLabel(d.level),
      effectiveLevel: d.effectiveLevel,
      status: d.status,
    })),
  };
}
