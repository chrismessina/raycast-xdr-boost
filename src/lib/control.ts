import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { environment, getPreferenceValues, LocalStorage } from "@raycast/api";
import { friendly } from "./displays";
import * as helper from "./helper";
import { HelperStatus, isStale } from "./helper";
import {
  acknowledged,
  BaselineLoss,
  baselineLost,
  boostsAnything,
  computeNext,
  Intent,
  NO_INTENT,
  Operation,
  parseExternalMax,
  parseIntent,
  parseLowBattery,
  parseStrategy,
  resolveOperation,
  Tuning,
} from "./intent";
import { levelFromPreference } from "./levels";
import { withFileLock } from "./lock";
import { log } from "./log";
import { notify } from "./notify";

const WANTED_KEY = "wanted";
const SETTLE_TIMEOUT_MS = 3000;
const SETTLE_POLL_MS = 100;
const lockPath = () => join(environment.supportPath, "intent.lock");

/** The saved intent (validated), for restore-after-restart; undefined when never set or unreadable. */
export async function getWanted(): Promise<Intent | undefined> {
  const raw = await LocalStorage.getItem<string>(WANTED_KEY);
  if (!raw) return undefined;
  try {
    return parseIntent(JSON.parse(raw));
  } catch {
    return undefined; // a corrupt value must not block later launches
  }
}

/** How the helper turns levels into light (Boost Strategy + External XDR Maximum), sent with every snapshot. */
export function tuning(): Tuning {
  const prefs = getPreferenceValues<Preferences>();
  return {
    strategy: parseStrategy(prefs.boostStrategy),
    externalMax: parseExternalMax(prefs.externalMax),
    lowBattery: parseLowBattery(prefs.pauseBelowBattery),
  };
}

export function defaultLevel(): number {
  return levelFromPreference(getPreferenceValues<Preferences>().defaultLevel).value;
}

async function poll(until: (s: HelperStatus) => boolean): Promise<HelperStatus> {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;
  let now = await helper.status();
  while (!until(now) && performance.now() < deadline) {
    await sleep(SETTLE_POLL_MS);
    now = await helper.status();
  }
  return now;
}

export interface Applied {
  after: HelperStatus;
  intent: Intent;
  /** The operation changed nothing for connected displays ("Already at Max" / "Already Off"). */
  saturated: boolean;
  /** An older build's helper was replaced and no saved levels existed: this change started from no boost (G3). */
  continuityLost: boolean;
  /** Which kind of loss, for the wording. */
  loss: BaselineLoss;
}

/** Shown wherever replacing an outdated helper lost the previous levels. */
export function continuityMessage(applied: Pick<Applied, "loss">): string {
  if (applied.loss === "restore")
    return "Boost turned off: the previous version's levels couldn't be carried over. Set a level to turn it back on.";
  if (applied.loss === "toggle")
    return "The previous version's levels couldn't be read, so the boost was turned off to be safe. Toggle again to turn it on.";
  return "The previous version's levels couldn't be carried over, so this change started from no boost.";
}

/**
 * The ONE way intent changes (the extension is the only writer). Inside a cross-process lock:
 * stop a helper left by an older build, read the saved intent, compute the complete next snapshot,
 * save it, send that same snapshot (replace a running helper's intent, or start one with it), and
 * succeed only when the helper reports back exactly that snapshot. The notification is posted after
 * the lock is released.
 */
export async function applyOperation(op: Operation): Promise<Applied> {
  const result = await withFileLock(lockPath(), async () => {
    let current = await helper.status();
    // Read (and validate) the saved intent BEFORE stopping anything, so a missing record is known up front.
    const savedBefore = await getWanted();
    const wasStale = isStale(current);
    // Decide toggles BEFORE a stale stop: the stopped read-back would say "off" for a helper that was boosting (G4).
    const resolved = resolveOperation(op, current, wasStale, savedBefore !== undefined);
    const loss = baselineLost(op, wasStale, savedBefore !== undefined);
    const continuityLost = loss !== "none";
    if (wasStale) {
      // An older build may ignore the new messages and not apply this build's limits; quit is the one message every
      // build must keep understanding. Its levels are treated as unknown, so the saved intent below carries over.
      log("stale helper: stopping", { pid: current.pid, protocol: current.protocol });
      await helper.stop();
      current = await poll((s) => !s.running);
      if (current.running) throw new Error("An older XDR Boost helper is still running and did not stop.");
    }
    const saved = savedBefore ?? NO_INTENT;
    const connected = current.displays.map((d) => d.uuid);
    const { intent, saturated } = computeNext(resolved, saved, connected);
    if (continuityLost) log("stale helper replaced without saved levels: started from no boost", { op: resolved });
    log("apply", { op: resolved, saved, intent, running: current.running });
    await LocalStorage.setItem(WANTED_KEY, JSON.stringify(intent));
    const ceiling = tuning();
    if (current.running) await helper.setLevels(intent, ceiling);
    else if (boostsAnything(intent)) await helper.start(intent.all, intent.levels, ceiling);
    const after = await poll((s) => !isStale(s) && acknowledged(s, intent, ceiling));
    if (isStale(after) || !acknowledged(after, intent, ceiling)) {
      log("not acknowledged", { intent, after: { running: after.running, all: after.allLevel, levels: after.levels } });
      throw new Error("The helper did not confirm the new levels within 3 seconds.");
    }
    return { after, intent, saturated, continuityLost, loss };
  });
  log("settled", { displays: result.after.displays.map((d) => [d.name, d.level, d.status]) });
  await notify(result.continuityLost ? continuityMessage(result) : friendly(result.after, scopeOf(op)));
  return result;
}

/** Which displays a notification should talk about. */
function scopeOf(op: Operation): "all" | string[] {
  if (op.kind === "displays") return Object.keys(op.levels);
  if (op.kind === "toggleDisplay") return [op.uuid];
  return "all";
}
