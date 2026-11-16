import { describe, expect, it } from "vitest";
import { decideKeepAlive } from "../keepalive";

const high = { all: 1.5625, levels: {} };

describe("decideKeepAlive", () => {
  it("does nothing when the preference is off", () => {
    expect(decideKeepAlive({ restoreAfterRestart: false, running: false, wanted: high })).toEqual({ action: "none" });
  });
  it("does nothing while the helper is running", () => {
    expect(decideKeepAlive({ restoreAfterRestart: true, running: true, wanted: high })).toEqual({ action: "none" });
  });
  it("never undoes an explicit Off", () => {
    expect(
      decideKeepAlive({ restoreAfterRestart: true, running: false, wanted: { all: 1, levels: { A: 1 } } }),
    ).toEqual({
      action: "none",
    });
  });
  it("does nothing when nothing was ever chosen", () => {
    expect(decideKeepAlive({ restoreAfterRestart: true, running: false, wanted: undefined })).toEqual({
      action: "none",
    });
  });
  it("restarts with the All Displays level and each display's own level", () => {
    const wanted = { all: 1, levels: { XDR: 1.375 } };
    expect(decideKeepAlive({ restoreAfterRestart: true, running: false, wanted })).toEqual({
      action: "start",
      all: 1,
      levels: { XDR: 1.375 },
    });
  });
});
