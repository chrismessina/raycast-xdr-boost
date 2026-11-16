import { runNoView } from "./lib/no-view";

/** Each connected display steps up one preset from its own level; unplugged displays keep theirs. */
export default async function Command() {
  await runNoView({ kind: "step", direction: 1 }, "Increasing XDR Boost", "XDR Boost Already at Max");
}
