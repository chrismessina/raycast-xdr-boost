import { OFF } from "./levels";

export interface KeepAliveInput {
  /** The `restoreAfterRestart` preference. */
  restoreAfterRestart: boolean;
  /** Whether the helper process is alive right now. */
  running: boolean;
  /** The last request, from LocalStorage; `undefined` if never set. */
  wanted: { all: number; levels: Record<string, number> } | undefined;
}

export type KeepAliveDecision = { action: "none" } | { action: "start"; all: number; levels: Record<string, number> };

/**
 * Whether the menu bar command should restart the helper. Pure, so it is unit-tested.
 * Restarts only when the user opted in, the helper is gone, and the last request boosted something
 * (an explicit Off stores 1.0, so it is never undone).
 */
export function decideKeepAlive({ restoreAfterRestart, running, wanted }: KeepAliveInput): KeepAliveDecision {
  if (!restoreAfterRestart || running || !wanted) return { action: "none" };
  const boosts = wanted.all > OFF || Object.values(wanted.levels).some((level) => level > OFF);
  return boosts ? { action: "start", all: wanted.all, levels: wanted.levels } : { action: "none" };
}
