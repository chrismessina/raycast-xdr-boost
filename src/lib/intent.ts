// The extension is the ONLY writer of intent (Codex DESIGN round 9, option A). An operation is turned into one
// complete snapshot {all, levels} here; that exact snapshot is saved, sent to the helper (which replaces its
// state with it and never derives intent itself), and verified on read-back. Pure: no Raycast or helper imports.
import type { HelperStatus } from "./helper";
import { EPSILON, MAX, OFF, stepLevel } from "./levels";

/** The All Displays level, plus each display's own level by hardware UUID (kept while it is unplugged). */
export interface Intent {
  all: number;
  levels: Record<string, number>;
}

export const NO_INTENT: Intent = { all: OFF, levels: {} };

export type Operation =
  /** All Displays → level: resets every per-display level. */
  | { kind: "all"; level: number }
  /** These displays → their levels; every other display, connected or unplugged, keeps its own. */
  | { kind: "displays"; levels: Record<string, number> }
  /** Increase / Decrease: each CONNECTED display steps from its own level. Unplugged displays are untouched. */
  | { kind: "step"; direction: 1 | -1 }
  /** Toggle: any connected display boosted → everything off; otherwise All Displays → `level`. */
  | { kind: "toggle"; level: number }
  /** One display: boosted → off; off → `level`. */
  | { kind: "toggleDisplay"; uuid: string; level: number }
  /** Apply the saved intent unchanged (restore after restart, replacing an outdated helper). */
  | { kind: "restore" };

export function resolve(intent: Intent, uuid: string): number {
  return intent.levels[uuid] ?? intent.all;
}

export function boostsAnything(intent: Intent): boolean {
  return intent.all > OFF || Object.values(intent.levels).some((level) => level > OFF);
}

export function sameIntent(a: Intent, b: Intent): boolean {
  const keys = new Set([...Object.keys(a.levels), ...Object.keys(b.levels)]);
  return (
    Math.abs(a.all - b.all) < EPSILON &&
    [...keys].every(
      (k) => a.levels[k] !== undefined && b.levels[k] !== undefined && Math.abs(a.levels[k] - b.levels[k]) < EPSILON,
    )
  );
}

/** Saved intent from storage, validated: anything that isn't finite numbers within range is dropped. */
export function parseIntent(raw: unknown): Intent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { all, levels } = raw as { all?: unknown; levels?: unknown };
  if (typeof all !== "number" || !Number.isFinite(all)) return undefined;
  const clean: Record<string, number> = {};
  if (levels && typeof levels === "object") {
    for (const [uuid, level] of Object.entries(levels as Record<string, unknown>)) {
      if (typeof level === "number" && Number.isFinite(level)) clean[uuid] = clamp(level);
    }
  }
  return { all: clamp(all), levels: clean };
}

function clamp(level: number): number {
  return Math.min(Math.max(level, OFF), MAX);
}

export interface Next {
  intent: Intent;
  /** True when the operation changed nothing for connected displays ("Already at Max" / "Already Off"). */
  saturated: boolean;
}

/**
 * The complete next intent for `op`, from the SAVED intent (never from what a stopped or outdated helper
 * reports) and the UUIDs of the XDR displays connected right now. Then the one "off everywhere" rule:
 * when every connected display resolves to off and no unplugged display keeps a boost, it is All Displays → Off.
 */
export function computeNext(op: Operation, saved: Intent, connected: string[]): Next {
  let intent: Intent;
  let saturated = false;
  switch (op.kind) {
    case "all":
      intent = { all: clamp(op.level), levels: {} };
      break;
    case "displays": {
      const levels = { ...saved.levels };
      for (const [uuid, level] of Object.entries(op.levels)) levels[uuid] = clamp(level);
      intent = { all: saved.all, levels };
      break;
    }
    case "step": {
      // Explicit levels for every connected display, even ones already at the end: never a global reset.
      const levels = { ...saved.levels };
      saturated = connected.length > 0;
      for (const uuid of connected) {
        const from = resolve(saved, uuid);
        const to = stepLevel(from, op.direction).value;
        if (Math.abs(to - from) >= EPSILON) saturated = false;
        levels[uuid] = to;
      }
      intent = { all: saved.all, levels };
      break;
    }
    case "toggle":
      intent = connected.some((uuid) => resolve(saved, uuid) > OFF)
        ? { all: OFF, levels: {} }
        : { all: clamp(op.level), levels: {} };
      break;
    case "toggleDisplay": {
      const on = resolve(saved, op.uuid) > OFF;
      intent = { all: saved.all, levels: { ...saved.levels, [op.uuid]: on ? OFF : clamp(op.level) } };
      break;
    }
    case "restore":
      // Applied exactly as saved (G1): normalizing here would turn "built-in off, XDR covered by All
      // Displays but unplugged" into Off everywhere and lose the XDR's High.
      return { intent: { all: saved.all, levels: { ...saved.levels } }, saturated: false };
  }
  return { intent: normalize(intent, connected), saturated };
}

/** "Every connected display off, nothing unplugged boosted" is All Displays → Off. No connected displays: unchanged. */
export function normalize(intent: Intent, connected: string[]): Intent {
  if (connected.length === 0) return intent;
  const connectedSet = new Set(connected);
  const everyConnectedOff = connected.every((uuid) => resolve(intent, uuid) <= OFF);
  const unpluggedBoosted = Object.entries(intent.levels).some(
    ([uuid, level]) => !connectedSet.has(uuid) && level > OFF,
  );
  return everyConnectedOff && !unpluggedBoosted ? { all: OFF, levels: {} } : intent;
}

/**
 * The helper has applied `intent`: a running helper reports exactly this snapshot (including unplugged
 * displays), and a snapshot that boosts nothing is acknowledged by the helper having quit.
 */
/** How the helper turns levels into light: the "Boost Strategy" and "External XDR Maximum" preferences. */
export interface Tuning {
  strategy: "adaptive" | "fixed";
  /** Max LIGHT gain on external XDR displays under "fixed". */
  externalMax: number;
}

export function acknowledged(after: HelperStatus, intent: Intent, tuning: Tuning): boolean {
  if (!boostsAnything(intent)) return !after.running;
  return (
    after.running &&
    sameIntent({ all: after.allLevel, levels: after.levels ?? {} }, intent) &&
    typeof after.externalMax === "number" &&
    Math.abs(after.externalMax - tuning.externalMax) < EPSILON &&
    after.strategy === tuning.strategy
  );
}

/** Max light gain on a built-in display, and the ceiling for the external preference (1.75^2.2). */
export const BUILT_IN_MAX_GAIN = Math.pow(1.75, 2.2);

/** The "External XDR Maximum" preference as a light gain, defaulting conservatively to 2×. */
export function parseExternalMax(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > OFF ? Math.min(value, BUILT_IN_MAX_GAIN) : 2;
}

/** The "Boost Strategy" preference; anything unexpected is the adaptive default. */
export function parseStrategy(raw: string | undefined): Tuning["strategy"] {
  return raw === "fixed" ? "fixed" : "adaptive";
}

/**
 * Toggles decide from what the displays are doing NOW (G2), not from saved intent: with the helper stopped
 * and High saved, the displays show no boost, so Toggle turns it on, as its label says. Called inside the
 * transaction's lock with the live read-back, it becomes an explicit operation.
 */
export function resolveToggle(
  op: Operation,
  live: { running: boolean; displays: { uuid: string; level: number }[] },
): Operation {
  const on = (uuid?: string) =>
    live.running && live.displays.some((d) => (uuid === undefined || d.uuid === uuid) && d.level > OFF);
  if (op.kind === "toggle") return { kind: "all", level: on() ? OFF : op.level };
  if (op.kind === "toggleDisplay") return { kind: "displays", levels: { [op.uuid]: on(op.uuid) ? OFF : op.level } };
  return op;
}

/**
 * The operation to compute, given how the helper was found. A STALE helper (an older build, about to be
 * stopped) can't report levels, and its stopped read-back would wrongly say "off" (G4). So its toggles decide
 * from the saved intent when there is one (computeNext's toggle branches). With nothing saved the direction is
 * unknowable (an older build can idle with nothing boosted), so they fall back to "off", a safe choice that
 * `baselineLost` reports to the user (G5). Everything else toggles from the live read-back (G2).
 */
export function resolveOperation(
  op: Operation,
  live: { running: boolean; displays: { uuid: string; level: number }[] },
  stale: boolean,
  savedKnown: boolean,
): Operation {
  if (!stale) return resolveToggle(op, live);
  if (savedKnown) return op;
  if (op.kind === "toggle") return { kind: "all", level: OFF };
  if (op.kind === "toggleDisplay") return { kind: "displays", levels: { [op.uuid]: OFF } };
  return op;
}

/** How a replaced older helper with no saved levels affected the operation the user INVOKED (G3, G5). */
export type BaselineLoss = "none" | "restore" | "toggle" | "change";

/**
 * Judged on the operation as invoked, not as resolved: a stale toggle with nothing saved is resolved to
 * "All Off" as a safe fallback, and that fallback must be disclosed, not exempted like a deliberate All level.
 */
export function baselineLost(invoked: Operation, stale: boolean, savedKnown: boolean): BaselineLoss {
  if (!stale || savedKnown || invoked.kind === "all") return "none";
  if (invoked.kind === "restore") return "restore";
  if (invoked.kind === "toggle" || invoked.kind === "toggleDisplay") return "toggle";
  return "change";
}
