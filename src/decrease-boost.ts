import { runNoView } from "./lib/no-view";

/** Each connected display steps down one preset from its own level, down to off; unplugged displays keep theirs. */
export default async function Command() {
  await runNoView({ kind: "step", direction: -1 }, "Decreasing XDR Boost", "XDR Boost Already Off");
}
