import { failToast, showError } from "@chrismessina/raycast-kit/toast";
import { launchCommand, LaunchType, showHUD, showToast, Toast } from "@raycast/api";
import { applyOperation, continuityMessage } from "./control";
import { hud } from "./displays";
import { status } from "./helper";
import type { Operation } from "./intent";
import { log } from "./log";

/**
 * Re-renders the menu bar item so its icon matches the new state now, not on the next interval tick.
 * Silent on failure, deliberately: `launchCommand` rejects whenever the menu bar command is disabled,
 * which is a normal setup for someone who only uses the hotkey commands or the AI tools. A failure
 * toast there would follow every successful change, and in an AI tool it could fail the tool's result.
 */
export async function refreshMenuBar(): Promise<void> {
  try {
    await launchCommand({ name: "menu-bar", type: LaunchType.Background });
  } catch (error) {
    log("menu bar refresh skipped", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The shared no-view flow: show a toast BEFORE any work, apply the operation (every decision happens inside
 * the locked transaction, from the saved intent), then confirm with a HUD from the read-back state.
 * `saturatedHud` replaces the HUD when the operation changed nothing ("XDR Boost Already at Max").
 */
export async function runNoView(op: Operation, title: string, saturatedHud?: string): Promise<void> {
  let toast: Toast | undefined;
  try {
    if ((await status()).displays.length === 0) {
      await showHUD("No XDR Display Found");
      return;
    }
    toast = await showToast({ style: Toast.Style.Animated, title });
    const applied = await applyOperation(op);
    const { after, saturated, continuityLost } = applied;
    await toast.hide();
    await refreshMenuBar();
    await showHUD(continuityLost ? continuityMessage(applied) : saturated && saturatedHud ? saturatedHud : hud(after));
  } catch (error) {
    log("failed", { op, error: error instanceof Error ? error.message : String(error) });
    if (toast) failToast(toast, error, { title: "Couldn't Change XDR Boost" });
    else await showError(error, { title: "Couldn't Change XDR Boost" });
  }
}
