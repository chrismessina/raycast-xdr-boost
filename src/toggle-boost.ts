import { defaultLevel } from "./lib/control";
import { runNoView } from "./lib/no-view";

/** Any connected display boosted → everything off; otherwise every display to the default level. */
export default async function Command() {
  await runNoView({ kind: "toggle", level: defaultLevel() }, "Toggling XDR Boost");
}
