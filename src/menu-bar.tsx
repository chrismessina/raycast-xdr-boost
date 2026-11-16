import { redactSecrets } from "@chrismessina/raycast-kit/errors";
import { showError } from "@chrismessina/raycast-kit/toast";
import { useEffect, useState } from "react";
import { Clipboard, environment, getPreferenceValues, Icon, Keyboard, LaunchType, MenuBarExtra } from "@raycast/api";
import { applyOperation, continuityMessage, getWanted, tuning } from "./lib/control";
import { allState, GAMMA_UNSUPPORTED, highestLevel, pauseLabel, shortLabel } from "./lib/displays";
import * as helper from "./lib/helper";
import { HelperDisplay, HelperStatus, isStale } from "./lib/helper";
import { dialIcon, menuBarIcon } from "./lib/icons";
import type { Operation } from "./lib/intent";
import { decideKeepAlive } from "./lib/keepalive";
import { indexOfLevel, LEVELS, presetAt } from "./lib/levels";
import { log } from "./lib/log";

const STATUS_SUFFIX: Partial<Record<HelperDisplay["status"], string>> = {
  paused: "Paused",
  waiting: "Waiting",
  limited: "Limited",
  "edr-unavailable": "EDR Unavailable",
};

export default function Command() {
  const [status, setStatus] = useState<HelperStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);

  async function report(err: unknown, title: string) {
    setError(redactSecrets(err instanceof Error ? err.message : String(err)));
    log(title, { error: err instanceof Error ? err.message : String(err) });
    // A background tick has no one looking: no toast.
    if (environment.launchType !== LaunchType.Background) await showError(err, { title });
  }

  useEffect(() => {
    (async () => {
      let current = await helper.status();
      const saved = await getWanted();
      const { restoreAfterRestart } = getPreferenceValues<Preferences>();
      const decision = decideKeepAlive({ restoreAfterRestart, running: current.running, wanted: saved });
      log("tick", { running: current.running, stale: isStale(current), saved, decision: decision.action });
      // An older build's helper (still running after an update) is replaced, and the saved intent re-applied,
      // so an update never leaves an unreadable helper boosting. Restore after restart applies the same intent.
      // A changed "External XDR Maximum" preference reaches a running helper on the next tick (or any change).
      const wanted = tuning();
      const ceilingChanged =
        current.running &&
        !isStale(current) &&
        (current.externalMax !== wanted.externalMax || current.strategy !== wanted.strategy);
      if (isStale(current) || decision.action === "start" || ceilingChanged) {
        const applied = await applyOperation({ kind: "restore" });
        current = applied.after;
        if (applied.continuityLost) setError(continuityMessage(applied));
      }
      setStatus(current);
    })()
      .catch((err) => report(err, "Couldn't Read XDR Boost"))
      .finally(() => setBusy(false));
  }, []);

  // isLoading stays true while a change runs, so Raycast keeps the command loaded until it settles.
  async function choose(op: Operation) {
    setBusy(true);
    try {
      const applied = await applyOperation(op);
      setStatus(applied.after);
      // A replaced older helper with nothing saved is disclosed here too, not cleared away.
      setError(applied.continuityLost ? continuityMessage(applied) : undefined);
    } catch (err) {
      await report(err, "Couldn't Change XDR Boost");
    } finally {
      setBusy(false);
    }
  }

  const displays = status?.displays ?? [];
  const highest = indexOfLevel(highestLevel(displays));
  const all = allState(displays);

  return (
    <MenuBarExtra
      icon={menuBarIcon(highest)}
      tooltip={`XDR Boost: ${shortLabel(highestLevel(displays))}`}
      isLoading={busy}
    >
      {error && (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item title={error} icon={Icon.ExclamationMark} />
          <MenuBarExtra.Item title="Copy Error" icon={Icon.Clipboard} onAction={() => Clipboard.copy(error)} />
        </MenuBarExtra.Section>
      )}
      {status?.gammaSupported === false && <MenuBarExtra.Item title={GAMMA_UNSUPPORTED} icon={Icon.Warning} />}
      {status && pauseLabel(status) && <MenuBarExtra.Item title={pauseLabel(status) as string} icon={Icon.Pause} />}
      {status && displays.length === 0 && <MenuBarExtra.Item title="No XDR Display Found" icon={Icon.Warning} />}
      {displays.length > 0 && (
        <MenuBarExtra.Section title="All Displays">
          {LEVELS.map((level, index) => (
            <MenuBarExtra.Item
              key={level.name}
              title={level.name}
              icon={dialIcon(index, all.kind === "preset" && all.index === index)}
              // ⌘0–⌘4 while the menu is open, as in Headroom's menu.
              shortcut={{ modifiers: ["cmd"], key: String(index) as Keyboard.KeyEquivalent }}
              onAction={() => choose({ kind: "all", level: level.value })}
            />
          ))}
          {/* Status rows, no action: shown only when no single preset describes every display. */}
          {all.kind === "custom" && <MenuBarExtra.Item title="Custom" icon={dialIcon(all.index, true)} />}
          {all.kind === "mixed" && <MenuBarExtra.Item title="Mixed" icon={dialIcon(all.index, true)} />}
        </MenuBarExtra.Section>
      )}
      {displays.length > 0 && (
        <MenuBarExtra.Section>
          {displays.map((d) => {
            const suffix = STATUS_SUFFIX[d.status];
            const preset = presetAt(d.level);
            return (
              <MenuBarExtra.Submenu
                key={d.uuid}
                title={`${d.name} (${shortLabel(d.level)}${suffix ? ` · ${suffix}` : ""})`}
                icon={dialIcon(indexOfLevel(d.level))}
              >
                {LEVELS.map((level, index) => (
                  <MenuBarExtra.Item
                    key={level.name}
                    title={level.name}
                    icon={dialIcon(index, preset === level)}
                    onAction={() => choose({ kind: "displays", levels: { [d.uuid]: level.value } })}
                  />
                ))}
                {!preset && <MenuBarExtra.Item title="Custom" icon={dialIcon(indexOfLevel(d.level), true)} />}
              </MenuBarExtra.Submenu>
            );
          })}
        </MenuBarExtra.Section>
      )}
    </MenuBarExtra>
  );
}
