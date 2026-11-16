---
title: "An XDR Boost helper from an older build kept running after a rebuild: protocol versioning and stale replacement inside the intent transaction"
date: 2026-11-15
category: architecture-patterns
module: xdr-boost-raycast-extension
problem_type: architecture_pattern
component: service_layer
symptoms:
  - "After a rebuild, the helper from the previous build kept running and kept boosting"
  - "status reported every display Off while that helper was still boosting, because its state file no longer decoded"
  - "Every change failed after 3 seconds with \"The helper did not confirm the new levels within 3 seconds.\""
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags:
  - "swift"
  - "long-running-process"
  - "detached-spawn"
  - "protocol-version"
  - "extension-update"
  - "single-writer"
---

# An XDR Boost helper from an older build kept running after a rebuild

The general pattern is in the plugin learning
`/Users/messina/Developer/GitHub/chrismessina/raycast-extensions-skills/plugins/raycast-extensions/learnings/architecture-patterns/long-running-helper-outlives-extension-updates.md`.
This doc holds XDR Boost's own incident, review history and code.

## Why the helper outlives the build

`helper.start` spawns the compiled `run` function with `detached: true` and `stdio: "ignore"`, then
calls `child.unref()`:
`/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/src/lib/helper.ts:71-92` (`start`; spawn at
83-86, unref at 91). Nothing couples the helper to the command's process. Replacing the binary in
`assets/` does not stop a running helper.

Recorded session observation, no capture kept: on 2026-11-15 a read-only
`ps -axo pid,ppid,lstart,command` showed the running helper (pid 44904, started 17:46, argv
`run 1.1875 "<state path>" {} 1.375`) with parent pid 1004, `Raycast Backend`. It was the current
build's helper, not the incident's. Rerun the same `ps` to re-check; it shows a parent at one moment,
not survival through every kind of update.

## The incident

**An uncaptured session account.** Everything in this list was recorded in the session on
2026-11-15; no log, process capture or old binary was kept, so none of it is independently
verified. The current code supports these failure modes (an undecodable state file falls back to Off
levels in `status`, `Exports.swift:280-302`; polling has a 3000 ms budget, `control.ts:28` and
`poll` at `control.ts:53-61`), which does not prove what the old binary did.

As recorded: after a rebuild, a helper from the previous build was still running, with argv
`run 1.375 "<state path>"` (shorter than the argv `helper.ts:75-82` now passes).

- It ignored the new build's per-display set notification, which it predated.
- Its state file no longer decoded into the new `StateFile` shape, so `status` reported every display
  Off while it was still boosting.
- Every change then waited out `SETTLE_TIMEOUT_MS` (3000,
  `/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/src/lib/control.ts:28`) and failed.
  The current text of that error is `"The helper did not confirm the new levels within 3 seconds."`
  (`control.ts:120`).
- It lacked the headroom cap the new build added. The cap is not a hardware safety limit:
  `/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/docs/solutions/pro-display-xdr-blanks-on-gamma-table-edr-boost.md`
  shows the panel blanked with the cap in place. Protocol freshness proves which contract is running,
  not that the panel is safe.

## What the code does now

**Protocol on both sides.** `helperProtocol = 6` at
`/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/swift/Sources/XDRBoostHelper/Exports.swift:37`
and `HELPER_PROTOCOL = 6` at
`/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/src/lib/protocol.ts:2`. Every state
write carries it (`writeState`, `Exports.swift:245-261`). `isStale` is `s.running && s.protocol !== HELPER_PROTOCOL`
(`helper.ts:106-109`).

**State is trusted only from the running helper.** `PidFile.isHelper` checks liveness, `argv[1] ==
"run"` and the JSON state path at `argv[3]` (`PidFile.isHelper`, `Exports.swift:94-98`). `status` accepts the state file
only when its pid equals that helper's pid, and reports `nil` for the protocol when the file does not
decode or carries none (`status`, `Exports.swift:280-287`). A helper whose file decodes but whose protocol
differs is also stale; the code treats every stale helper's levels as unusable and uses saved intent
instead.

**Replacement inside the single-writer transaction.** `applyOperation`
(`/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/src/lib/control.ts:90-127`) holds the
cross-process lock (`src/lib/lock.ts`) for the whole sequence:

1. Read live status and the saved intent, and decide the operation and any baseline loss before
   stopping anything (`control.ts:92-99`).
2. If stale: send `quit`, poll until the helper is gone, and throw
   `"An older XDR Boost helper is still running and did not stop."` if it is not
   (`control.ts:100-107`). No second helper is started next to it. That `quit` reaches older builds
   is assumed from the notification name being unchanged
   (`com.chrismessina.xdr-boost.quit`, `Notifications.quit` at `Exports.swift:20`); it is not tested against old binaries,
   and the throw is what covers a build that ignores it.
3. Compute the next snapshot from the saved intent, save it, then send it to a running helper or
   start one **only if the snapshot boosts something** (`control.ts:108-116`).
4. Poll for `!isStale(s) && acknowledged(s, intent, ceiling)` (`ceiling` is now the whole
   `tuning()`: strategy and External XDR Maximum), and accept only if the final read-back
   passes the same test: `if (isStale(after) || !acknowledged(after, intent, ceiling)) throw`
   (`control.ts:117-121`). `acknowledged` treats a snapshot that boosts nothing as acknowledged by
   the helper having quit, compares levels and the ceiling within `EPSILON` = `1e-9`, and requires
   the same strategy
   (`/Users/messina/Developer/GitHub/chrismessina/raycast-xdr-boost/src/lib/intent.ts:142-151`;
   `src/lib/levels.ts:22`).

**Toggles and lost baselines.** `resolveOperation` decides a stale helper's toggles from the saved
intent, and falls back to Off when nothing is saved (`intent.ts:183-201`). `baselineLost` judges the
loss on the operation as invoked, so a toggle resolved to Off is disclosed while a deliberate All
level is exempt (`intent.ts:203-215`). The wording is `continuityMessage` (`control.ts:74-81`), for
example `"The previous version's levels couldn't be read, so the boost was turned off to be safe.
Toggle again to turn it on."`

**Where the loss is disclosed:** the no-view HUD (`src/lib/no-view.ts:40`), the Set view toast
(`src/set-boost.tsx:48`), the AI tool's `warning` field (`src/tools/set-boost.ts:53`), the menu-bar
row on launch (`src/menu-bar.tsx:52`) and after a menu action (`src/menu-bar.tsx:67`, which now
shows the warning instead of clearing it), and the notification (`control.ts:125`). The notification
is optional and can fail silently: it posts only when `notifyOnChange` is on, and a failed
`osascript` is logged, not raised (`src/lib/notify.ts:14-21`).

**Tests.** `src/lib/__tests__/protocol.test.ts:8-13` reads `helperProtocol` from the Swift source and
compares it with `HELPER_PROTOCOL`. It catches a one-sided bump. It does not run the compiled helper,
so it says nothing about which helper is running on a machine.

## Review history

The stale-replacement design and its regressions went through Codex rounds 9 to 13 on 2026-11-15/16.
Reports are in
`/Users/messina/.claude/plugins/data/codex-openai-codex/state/raycast-xdr-boost-398b30ff1e50d06e/jobs/`:

| Round | Job | Outcome |
|---|---|---|
| 9 (DESIGN) | `task-mwigvxge-0h7jqy.json` | REDESIGN, recommend option A (the extension as the only writer of complete snapshots, `intent.ts:1`). Stale fix PARTIAL; F16 open (toggles read the stopped helper's Off). |
| 10 | `task-mwii2p8j-2rll1m.json` | PATCH. F16 fixed for its original paths. G1-G3 open, including G3: a missing saved intent silently became Off. Both sides were protocol 3. |
| 11 | `task-mwiiin3e-tfcgzn.json` | PATCH. G4: the toggle was resolved from the read-back after the stale stop, so Toggle restarted the boost. |
| 12 | `task-mwiix8p1-s6okes.json` | PATCH. G4 fixed (resolve before the stop). G5: an unknown stale state was assumed On, and the Off fallback inherited the All-level warning exemption. |
| 13 | `task-mwij5kau-fqt0ut.json` | PASS. G5 fixed: loss judged on the invoked operation. |

Round 10's report states both sides were protocol 3; the current protocol is 6. That 3→4 came with
`externalMax`, and 4→5→6 with the Boost Strategy (`strategy`) and pause (`pauseReasons`) fields, is a
recorded session account; no diff between the versions was kept. The current snapshot and state file
carry all three (`postSet` at `Exports.swift:23-26`; `StateFile` at `Exports.swift:49-59`).

A later truth review of this doc's predecessor (`task-mwilr9ex-dji4jm.json`) found the final
acceptance did not re-check staleness and the menu action cleared the warning. Both are fixed at
`control.ts:118` and `menu-bar.tsx:67`.

## When this applies again

- Any change to the helper's messages, state-file shape or `run` argv: bump `helperProtocol` and
  `HELPER_PROTOCOL` in the same change.
- When `status` and what the displays show disagree after a rebuild, run
  `ps -axo pid,ppid,lstart,command | grep compiled_raycast_swift` and look for a helper started before
  the build.
