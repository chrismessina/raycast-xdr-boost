import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELPER_PROTOCOL } from "../protocol";

// The TS and Swift sides must bump together: a mismatch makes every running helper look stale (or none).
describe("helper protocol", () => {
  it("matches helperProtocol in the Swift helper", () => {
    const swift = readFileSync(join(__dirname, "../../../swift/Sources/XDRBoostHelper/Exports.swift"), "utf8");
    const match = /let helperProtocol = (\d+)/.exec(swift);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(HELPER_PROTOCOL);
  });
});
