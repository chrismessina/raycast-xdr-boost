import { applyOperation, continuityMessage } from "../lib/control";
import { hud, pauseLabel, shortLabel } from "../lib/displays";
import { status } from "../lib/helper";
import type { Operation } from "../lib/intent";
import { clampLevel, MAX, OFF } from "../lib/levels";
import { log } from "../lib/log";
import { refreshMenuBar } from "../lib/no-view";

type Input = {
  /**
   * The boost level: a position from 1.0 (off) to 1.75 (Max). Presets: 1.1875 Low, 1.375 Medium,
   * 1.5625 High, 1.75 Max; any value in between is allowed (50% of the way to Max is 1.375). It is not a
   * brightness multiplier: how much brighter a level looks depends on the display and its brightness setting.
   */
  level: number;
  /**
   * Optional: one display to change, by the `id` or `name` get-boost lists (e.g. "Pro Display XDR").
   * Use the id when two displays share a name. Leave it out to change every XDR display.
   */
  display?: string;
};

/** Sets the XDR brightness boost for every display, or for one display by id or name. 1.0 turns it off. */
export default async function tool(input: Input) {
  log("tool set-boost", { input });
  if (typeof input.level !== "number" || !Number.isFinite(input.level)) {
    throw new Error("level must be a number from 1.0 (off) to 1.75 (maximum).");
  }
  if (input.level < OFF || input.level > MAX) {
    throw new Error(`level ${input.level} is out of range: use 1.0 (off) to 1.75 (maximum).`);
  }
  const level = clampLevel(input.level);
  const name = input.display?.trim(); // models send "" for an optional string: treat it as absent
  let op: Operation;
  if (name) {
    const displays = (await status()).displays;
    const byId = displays.filter((d) => d.uuid.toLowerCase() === name.toLowerCase());
    const matches = byId.length ? byId : displays.filter((d) => d.name.toLowerCase() === name.toLowerCase());
    const listed = displays.map((d) => `${d.name} (id ${d.uuid})`).join(", ") || "none";
    if (matches.length === 0) throw new Error(`No XDR display matches "${name}". Connected: ${listed}.`);
    if (matches.length > 1)
      throw new Error(`More than one display is named "${name}"; pass its id. Connected: ${listed}.`);
    op = { kind: "displays", levels: { [matches[0].uuid]: level } };
  } else {
    op = { kind: "all", level };
  }
  const applied = await applyOperation(op);
  const { after } = applied;
  await refreshMenuBar();
  return {
    summary: hud(after),
    ...(pauseLabel(after) ? { paused: pauseLabel(after) } : {}),
    ...(applied.continuityLost ? { warning: continuityMessage(applied) } : {}),
    displays: after.displays.map((d) => ({
      id: d.uuid,
      name: d.name,
      level: d.level,
      levelName: shortLabel(d.level),
      effectiveLevel: d.effectiveLevel,
      status: d.status,
    })),
  };
}
