// The only module that touches the Swift helper (`swift/`, compiled by `ray build` through extensions-swift-tools).
import { spawn } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as swift from "swift:../../swift";
import { environment } from "@raycast/api";
import { HELPER_PROTOCOL } from "./protocol";

export type DisplayStatus = "off" | "boosted" | "limited" | "waiting" | "edr-unavailable" | "paused";

export interface HelperDisplay {
  /** Hardware UUID: stable across reconnects, so per-display levels follow the display. */
  uuid: string;
  id: number;
  name: string;
  builtIn: boolean;
  potentialEDR: number;
  currentEDR: number;
  /** The level asked for on this display (1.0 = off). */
  level: number;
  /** The LIGHT gain actually applied (1.0 = no boost): a different unit from `level`, which is a position Off → Max. */
  effectiveLevel: number;
  status: DisplayStatus;
}

export { HELPER_PROTOCOL } from "./protocol";

export interface HelperStatus {
  /** The running helper's protocol; undefined/null when not running or when an older build is running. */
  protocol?: number | null;
  running: boolean;
  pid?: number;
  /** The "All Displays" level. */
  allLevel: number;
  /** Per-display levels by UUID, including remembered unplugged displays. */
  levels: Record<string, number>;
  /** The running helper's ceiling for external XDR displays (light gain, "fixed" strategy); null when not running. */
  externalMax?: number | null;
  /** The running helper's strategy; null when not running. */
  strategy?: "adaptive" | "fixed" | null;
  /** Why a running helper has paused the boost: screen-locked, screen-saver, system-sleep, … (empty when boosting). */
  pauseReasons?: string[];
  /** False on M5 Pro / M5 Max, where macOS ignores gamma tables. */
  gammaSupported?: boolean;
  updatedAt?: string;
  /** XDR displays connected right now (read live, even when the helper is not running). */
  displays: HelperDisplay[];
}

export const statePath = () => join(environment.supportPath, "state.json");

/** Where `ray build` puts the compiled package (`compiled_raycast_swift/<package folder name>`). */
const binaryPath = () => join(environment.assetsPath, "compiled_raycast_swift", "swift");

export async function status(): Promise<HelperStatus> {
  return (await swift.status(statePath())) as HelperStatus;
}

/**
 * Spawns the exported `run` function DETACHED, so the helper outlives this command's process.
 * The generated wrapper is not used here because it waits for the process to exit. The argv shape
 * (function name, then each argument JSON-encoded, in declaration order) is the one the wrapper uses;
 * the helper identifies itself by the state path at argv[3], so keep `level, state, levels` in order.
 */
/** How the helper turns levels into light: see swift/Sources/XDRBoostHelper/Curve.swift. */
export interface HelperTuning {
  externalMax: number;
  strategy: string;
}

export async function start(all: number, levels: Record<string, number>, tuning: HelperTuning): Promise<void> {
  const bin = binaryPath();
  await chmod(bin, 0o755);
  await mkdir(environment.supportPath, { recursive: true });
  const args = [
    "run",
    JSON.stringify(all),
    JSON.stringify(statePath()),
    JSON.stringify(levels),
    JSON.stringify(tuning.externalMax),
    JSON.stringify(tuning.strategy),
  ];
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
  });
  // A failed spawn reports through "error"; without a listener it would crash the command.
  child.on("error", () => undefined);
  // Never trust pid 0 or undefined (hotspot-meter's guard: kill(0) would hit our own group).
  if (!child.pid) throw new Error(`Could not start the helper at ${bin}`);
  child.unref();
}

/** Replaces the running helper's intent with this complete snapshot. */
export async function setLevels(
  intent: { all: number; levels: Record<string, number> },
  tuning: HelperTuning,
): Promise<void> {
  await swift.setLevels(intent.all, intent.levels, tuning.externalMax, tuning.strategy);
}

export async function stop(): Promise<void> {
  await swift.quit();
}

/** A helper left running by an older build of the extension (it survives updates and rebuilds). */
export function isStale(s: HelperStatus): boolean {
  return s.running && s.protocol !== HELPER_PROTOCOL;
}
