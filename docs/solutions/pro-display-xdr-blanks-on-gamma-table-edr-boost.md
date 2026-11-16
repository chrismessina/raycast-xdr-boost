---
title: "Gamma-table EDR boosts blanked a Pro Display XDR above Medium at headroom 5.69, and the blank held until the display cable was reconnected"
date: 2026-11-15
category: integration-issues
module: xdr-boost-raycast-extension
problem_type: integration_issue
component: service_layer
symptoms:
  - "The external Pro Display XDR went black on a single CGSetDisplayTransferByTable write at ×1.5625 (High), the only table write in the helper log for that change"
  - "High and Max ran without blanking earlier the same day, when the display reported headroom 11.45 instead of 5.69"
  - "Killing the boosting process did not bring the picture back, although the read-back last table entry was the plain 0.99999994"
  - "macOS still reported the blank display as active, awake and online at 3008x1692@60"
  - "Only unplugging and replugging the USB-C/Thunderbolt cable restored it (one recovery took about 2 minutes disconnected)"
root_cause: undetermined_hardware_limit
resolution_type: config_change
severity: high
framework_version: "macOS 27.2.1 (build 26B131), Darwin 27.2.0, Apple M3 Max, Pro Display XDR at 60 Hz"
related_components:
  - "frontend"
tags:
  - "pro-display-xdr"
  - "edr"
  - "gamma-table"
  - "cgsetdisplaytransferbytable"
  - "brightness-boost"
  - "headroom"
  - "macos"
  - "raycast"
---

# Gamma-table EDR boosts blanked a Pro Display XDR above Medium at headroom 5.69, and the blank held until the cable was reconnected

**Status: mitigated, cause unresolved.** XDR Boost now limits external XDR displays through a
default "Boost Strategy" that caps modeled light output (see Mitigation). Why the panel blanks, and
the safe limit across the brightness range, are not established. `root_cause:
undetermined_hardware_limit` is a new value (the corpus has none for an unresolved hardware cause).
`resolution_type: config_change` was chosen because the mitigation is a conservative,
user-adjustable default (a preference with a fallback strategy), not a fix for the cause.

## Problem

Boosting an external Apple Pro Display XDR above SDR brightness with a scaled display transfer table
blanked the panel at High and Max on one occasion. The same levels had held earlier the same day at a
different reported headroom. The blank did not clear when the boost stopped. It held until the
display's data cable was unplugged and plugged back in.

Observed 2026-11-15. Apple M3 Max (`system_profiler`). macOS 27.2.1 (build 26B131), Darwin 27.2.0
(`sw_vers` / `uname -r`, captured 2026-11-15). Pro Display XDR at 60 Hz, preset
"Pro Display XDR (P3-1600 nits)", auto-brightness off, brightness slider at about 3/4 (the owner's
System Settings screenshot).

## Symptoms

- With the slider at about 3/4, `NSScreen.maximumExtendedDynamicRangeColorComponentValue` (current
  headroom) on the XDR read **5.69**. Medium (×1.375) held. **High (×1.5625) blanked the XDR.** The
  helper log, captured with `log stream`, shows exactly one table write (×1.5625) for that change and
  no rebuild or re-assert lines. Max (×1.75) also blanked.
- Earlier the same day the XDR reported headroom **11.45**, and High and Max held. Medium was not
  separately recorded at that headroom. The slider position then was not recorded. A higher headroom
  would be consistent with a lower slider if xdr-lift's note holds (it says lowering the native
  slider raises headroom; not checked here), but that is an inference.
- After the blank, the helper was killed. A `CGGetDisplayTransferByTable` probe then read a last
  entry of `0.99999994` on both displays, which is the plain table's endpoint. Only the last entry was
  checked, not the whole table. The picture did not return.
- `CGDisplayIsActive`, `CGDisplayIsAsleep` and `CGDisplayIsOnline` reported the XDR active, awake
  and online, at 3008x1692@60.
- Unplugging and replugging only the USB-C/Thunderbolt cable, with the display kept on power,
  restored the picture. One recovery took about 2 minutes disconnected.
- The built-in Liquid Retina XDR was unaffected at every level.

## What Didn't Work

- **A headroom cap** (table factor ≤ current headroom). When the blank happened, `Booster.write`
  wrote `min(requested, headroom)` on every path. That code has since been replaced (see
  Mitigation), so there is no current line to cite; the protocol-4 source it describes was read on
  2026-11-15 and is not kept. At headroom 5.69 the cap allowed ×1.5625, and the panel blanked anyway.
  Reported current headroom did not prevent this blank; that conclusion needs no light model. The
  next section gives a possible reason, under an upstream model.
- **Stopping the boost to recover.** After the process was killed, the table endpoint read back
  plain and the panel stayed black. On an orderly quit the helper also calls
  `CGDisplayRestoreColorSyncSettings()` (`tearDown`, `Booster.swift:506-513`; `Session.quit` in
  `swift/Sources/XDRBoostHelper/Exports.swift:237-243`),
  but a process-driven restore after a blank was not separately tested. **Inference, not
  established:** because the table read back plain while the picture stayed black, and only a cable
  reconnect recovered it, the fault appears to persist downstream of the transfer table (the
  display, its link, or the OS display pipeline). Which of these was not isolated.
- **Assuming it is specific to XDR Boost's code.** The owner reproduced the symptom in other apps.
  Headroom (https://github.com/fich-l/headroom) blanked at High and Max and held at Medium (owner
  observation). This project records Headroom as its port source and as using the same gamma-table
  technique (`Booster.swift:11-15`, `NOTICE.md`); that is our provenance record, not an independent
  check of Headroom's current code. Vivid, a commercial brightness app,
  also blanks above Medium; its internal technique is not known. This argues against a defect unique
  to this extension. It does not identify the responsible component.

## Under xdr-lift's gamma model

Everything in this section rests on an upstream claim that was not checked against this display.
xdr-lift states that `CGSetDisplayTransferByTable` entries are gamma-encoded, so scaling the table by
`f` scales emitted light by about `f^2.2`: "scaling it by f scales light by f^2.2, so a linear
multiplier k is written as k^(1/2.2)" (https://github.com/Justaboringname/xdr-lift,
`app/Booster.swift`). xdr-lift also says it checked this against an EDR reference; we have not
reproduced that check. What this repo's code established at the time of the blank: XDR Boost
multiplied the captured table by the level directly and capped that factor at
`min(requested, headroom)` (the current `Curve.swift` header records the same history, lines 9-10).
**Under xdr-lift's quoted approximation**, and if headroom is a linear light ratio, a factor equal to
the headroom would ask for about `H^2.2` in light, so the old cap compared quantities in different
units.

The observations, converted to light **under two assumptions**: light gain = `f^2.2` (xdr-lift's
approximation) and SDR white = 1600/H nits (assuming the preset's 1600-nit peak is what headroom
divides). Neither is measured. The nit column is arithmetic under those assumptions, not luminance.

| Headroom H | Level | Table factor f | Light gain f^2.2 | As a share of H | Modeled peak | Result |
|---|---|---|---|---|---|---|
| 5.69 | Medium | 1.375 | 2.01× | ~0.35·H | ~565 nits | held |
| 5.69 | High | 1.5625 | 2.67× | ~0.47·H | ~750 nits | **blanked** |
| 5.69 | Max | 1.75 | 3.43× | ~0.60·H | ~965 nits | **blanked** |
| 11.45 | High | 1.5625 | 2.67× | ~0.23·H | ~375 nits | held |
| 11.45 | Max | 1.75 | 3.43× | ~0.30·H | ~480 nits | held |

Two other projects cap light gain well below the headroom. These are attributed, corroborating
curves, not measurements of this display, and were not verified against their source in this doc:

- **Illuminate** is described as capping light gain at `min(0.6·H, 2.0, nitsCap/sdrWhite)`, where
  `sdrWhite = panelPeak/H`
  (https://github.com/fackelmeyer/illuminate/blob/main/Sources/IlluminateCore/BoostCurve.swift). Its
  2.0 default is about XDR Boost's Medium (2.01× under the model above).
- **xdr-lift** is described as capping at `min(k, 0.95·H)` and writing `k^(1/2.2)` into the table
  (https://github.com/Justaboringname/xdr-lift, `app/Booster.swift`).

**Our estimate, from the five outcomes above at two headrooms (three held, two blanked), under both
assumptions:** the blanks line up with modeled peak output rather than with the table factor. Every
held point models at or below ~565 nits, and every blanked point at or above ~750 nits, so the
modeled limit falls somewhere between those. A limit near 600 nits for this Pro Display XDR is our
estimate from these five points, not a measured or documented limit.

## Mitigation (what XDR Boost does now)

The current code adopts xdr-lift's model rather than verifying it: levels are positions, and the
helper writes a **light gain** to the table as `gain^(1/2.2)`. Everything below about nits is
therefore under the same two assumptions as the table above (light = f^2.2, SDR white = peak/H).

- **Levels are positions.** Off 1, Low 1.1875, Medium 1.375, High 1.5625, Max 1.75
  (`src/lib/levels.ts:7-13`). A level's
  position is spaced evenly in light from 1 to the display's maximum gain, then gamma-encoded
  (`Curve.tableFactor(level:maxGain:maxLevel:)`,
  `swift/Sources/XDRBoostHelper/Curve.swift:60-65`). `factor(for:)` in
  `Booster.swift:118-129` puts these together per display.
- **"Boost Strategy" preference** (`boostStrategy`, default `adaptive`, "Follow Brightness";
  alternative `fixed`, "Fixed Maximum"):
  `package.json`, parsed by
  `parseStrategy` in `src/lib/intent.ts:162-165`.
  - **adaptive:** max light gain = `min(0.6·H, 1.75^2.2, nitsCap·H/peak)` (`Curve.maxGain`,
    `Curve.swift:52-58`). The 0.6·H share and the per-model peaks are adapted from Illuminate's
    `BoostCurve.swift` and `DisplayProfile.swift` (https://github.com/fackelmeyer/illuminate), as
    the `Curve.swift` header (lines 12-18) records; not re-checked against Illuminate's source here.
  - **Per-model profile** (`Curve.profile`, `Curve.swift:38-45`): Pro Display XDR peak 1600, nitsCap
    560; Studio Display XDR peak 2000, nitsCap 560 (not tested on that model); any other external XDR
    peak 1600, nitsCap 560; built-in, no nits cap. Matching is by display name.
  - **The 560-nit cap is our estimate,** from the five outcomes at two headrooms in the table above
    (held at modeled ~565 nits and below, blanked at ~750 and above), with a margin. It is not a
    measured or documented limit. (The comment at `Curve.swift:40` says "Measured"; the nit values
    there are modeled, not measured.)
  - **fixed:** built-in Max = `1.75^2.2` (≈ 3.43× light); external Max = the "External XDR
    Maximum" preference, now a light gain (1.5, 2 default, 2.5, 3, 3.42;
    `parseExternalMax`, `intent.ts:156-160`).
- **Every write is held to light ≤ 0.95·H,** xdr-lift's cap as attributed above (`tableCap`,
  `Booster.swift:131-134`, applied in `write`, `Booster.swift:405-418`, and in `tick`'s `desired`).
- **What the curve gives on this display, by arithmetic** (a standalone run of `Curve.swift`
  reported by the author; the same numbers re-derive from the formula): at H 5.69, adaptive Max
  = light 1.99×, table factor 1.368, modeled ~560 nits; at H 11.45, adaptive Max reaches the
  `1.75^2.2` ceiling, table factor 1.75. Built-in Max is table 1.75 under both strategies. Compared
  with the five outcomes: at H 5.69 the new Max sits at modeled ~560 nits, just under Medium's held
  ~565; at H 11.45 it equals the old Max, which held (~480 modeled nits). Neither point has been
  re-tested with the new code.
- **Not about blanking, but in the same code:** a pause set (`pauseReasons`, `setPaused` at
  `Booster.swift:224-251`; observers in `Session.observePauseReasons`,
  `swift/Sources/XDRBoostHelper/Exports.swift:210-235`) releases every display on screen saver, lock, inactive
  session, sleep, displays asleep or Low Power Mode, with status `.paused`. `gammaSupported()`
  (`Exports.swift:332-343`, after Illuminate's GammaCompatibility) reports M5 Pro / M5 Max, where
  the table has no visible effect. EDR counts as engaged above headroom 1.05 (`engagedHeadroom`,
  `Booster.swift:54-55`). On/off follows the nominal level through `requestKey`, not the computed
  factor (`apply`, `Booster.swift:262-308`), so an adaptive gain of 1.0 does not switch a requested
  boost off.

Its safety across the slider range, and on other displays, is unverified.

The technique, for recognition:

- A 1×1 EDR trigger window keeps the panel in EDR mode (`makeTrigger`, `Booster.swift:456-475`).
- The display transfer table (`CGSetDisplayTransferByTable`) is multiplied by a factor above 1
  (`write`, `Booster.swift:412-414`).

## Prevention

- Do not treat `maximumExtendedDynamicRangeColorComponentValue` as a safe table factor for an
  external Pro Display XDR. A cap of `f ≤ H` did not prevent this blank. Under xdr-lift's model the
  table factor is gamma-encoded, so it is not in headroom's units either.
- Test any gamma-table boost on the XDR at a **high** SDR slider position (low headroom), not only
  where the slider happens to be. Holding at high headroom did not predict holding at low headroom.
- Before testing above Medium on an XDR, be ready to unplug the data cable to recover. Killing the
  process did not recover it.
- Keep the built-in and external panels on separate caps. The built-in panel's behavior says nothing
  about the external one.
- Before raising the 560-nit cap, record held/blanked results at several slider positions under
  the adaptive strategy, with headroom logged for each, and check them against the five-outcome
  estimate. A luminance measurement would test the 1600/H and f^2.2 assumptions directly.

## Related

- Headroom (same technique, port source): https://github.com/fich-l/headroom
- xdr-lift (gamma-encoding note, `0.95·H` cap, as attributed above): https://github.com/Justaboringname/xdr-lift
- Illuminate (`BoostCurve`, `DisplayProfile`, `GammaCompatibility`, as attributed above): https://github.com/fackelmeyer/illuminate
- The curve: `swift/Sources/XDRBoostHelper/Curve.swift`
- The only boosted-table writer:
  `swift/Sources/XDRBoostHelper/Booster.swift:405-418` (`write`)
- `docs/solutions/helper-outlives-extension-updates.md`
