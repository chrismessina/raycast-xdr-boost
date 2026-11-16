// Pure presentation of per-display state: how the menu summarizes displays, and the words notifications and
// HUDs use. Intent changes live in intent.ts. No Raycast or helper imports, so every rule here is unit-tested.
import type { HelperDisplay, HelperStatus } from "./helper";
import { EPSILON, indexOfLevel, LEVELS, OFF, presetAt } from "./levels";

/** What "All Displays" shows: a preset when every display shares it, else "Custom" or "Mixed". */
export type AllState =
  { kind: "preset"; index: number } | { kind: "custom"; index: number } | { kind: "mixed"; index: number };

export function sameLevel(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** The highest level across displays (the menu bar dial shows it); 1.0 with no displays. */
export function highestLevel(displays: HelperDisplay[]): number {
  return displays.reduce((max, d) => Math.max(max, d.level), OFF);
}

export function allState(displays: HelperDisplay[]): AllState {
  const index = indexOfLevel(highestLevel(displays));
  if (displays.length === 0) return { kind: "preset", index: 0 };
  const first = displays[0].level;
  if (!displays.every((d) => sameLevel(d.level, first))) return { kind: "mixed", index };
  const preset = presetAt(first);
  return preset ? { kind: "preset", index: LEVELS.indexOf(preset) } : { kind: "custom", index };
}

/** "Medium", "Off" or "Custom": never the number. */
export function shortLabel(level: number): string {
  return presetAt(level)?.name ?? "Custom";
}

// Max is "at maximum boost", not "as bright as it goes": on an external XDR, Max is the user's ceiling (H1).
const WORDS = ["no longer boosted", "a little brighter", "brighter", "much brighter", "at maximum boost"];

function describeOne(d: HelperDisplay, plural: boolean): string {
  const subject = plural ? "Your displays are" : `${d.name} is`;
  if (d.level <= OFF) return `${subject} no longer boosted.`;
  if (d.status === "waiting" || d.status === "edr-unavailable")
    return `${plural ? "Your displays" : d.name} will brighten once ${plural ? "they allow" : "it allows"} extra brightness.`;
  if (d.status === "limited") return `${subject} as bright as ${plural ? "they" : "it"} can go right now.`;
  const words = WORDS[indexOfLevel(d.level)];
  return `${subject} ${words}.`;
}

/**
 * Notification text after a change: relative words, never numbers. Speaks about "your displays" when
 * every display ended up the same, otherwise one sentence per display that the change touched.
 */
export function friendly(after: HelperStatus, scope: "all" | string[]): string {
  const displays = after.displays;
  if (displays.length === 0) return "No XDR display is connected, so nothing changed.";
  const paused = pauseLabel(after);
  if (paused) {
    // Saved, not applied (J4): say when it takes effect instead of announcing brightness.
    const state = allState(displays);
    const name = state.kind === "preset" ? LEVELS[state.index].name : state.kind === "mixed" ? "your levels" : "Custom";
    return `Boost set to ${name}. It applies when this ends: ${paused.replace(/^Paused: /, "")}.`;
  }
  const uniform = displays.every((d) => sameLevel(d.level, displays[0].level) && d.status === displays[0].status);
  if (uniform && (scope === "all" || displays.length > 1)) return describeOne(displays[0], displays.length > 1);
  const touched = scope === "all" ? displays : displays.filter((d) => scope.includes(d.uuid));
  return (touched.length ? touched : displays).map((d) => describeOne(d, false)).join(" ");
}

const PAUSE_LABELS: Record<string, string> = {
  "screen-saver": "Screen Saver",
  "screen-locked": "Screen Locked",
  "session-inactive": "Another User Is Active",
  "system-sleep": "Sleeping",
  "displays-asleep": "Displays Asleep",
  "low-power-mode": "Low Power Mode",
};

/** "Paused: Low Power Mode", or undefined when the boost isn't paused. One reason shown, in a stable order. */
export function pauseLabel(status: HelperStatus): string | undefined {
  const reasons = status.running ? (status.pauseReasons ?? []) : [];
  const first = Object.keys(PAUSE_LABELS).find((reason) => reasons.includes(reason)) ?? reasons[0];
  return first ? `Paused: ${PAUSE_LABELS[first] ?? first}` : undefined;
}

/** Shown on M5 Pro / M5 Max, where macOS accepts gamma tables but doesn't display them. */
export const GAMMA_UNSUPPORTED = "Not supported on M5 Pro / M5 Max: macOS ignores the gamma boost there";

/** HUD text after a change. */
export function hud(after: HelperStatus): string {
  if (after.displays.length === 0) return "No XDR Display Found";
  if (!after.running) return "XDR Boost Off";
  const state = allState(after.displays);
  const suffix = pauseLabel(after) ? " (Paused)" : "";
  if (state.kind === "mixed") return `XDR Boost: Mixed${suffix}`;
  if (state.kind === "custom") return `XDR Boost: Custom${suffix}`;
  return state.index === 0 ? "XDR Boost Off" : `XDR Boost: ${LEVELS[state.index].name}${suffix}`;
}
