import { describe, expect, it } from "vitest";
import { isWithinTensionWindow } from "./tensionWindow";

describe("isWithinTensionWindow", () => {
  it("enforces nothing when the reading is unknown", () => {
    expect(isWithinTensionWindow({ minTension: 60 }, undefined)).toBe(true);
  });

  it("enforces nothing on an unbounded definition", () => {
    expect(isWithinTensionWindow({}, 12)).toBe(true);
  });

  it("gates below minTension, inclusive at the bound", () => {
    expect(isWithinTensionWindow({ minTension: 60 }, 59.9)).toBe(false);
    expect(isWithinTensionWindow({ minTension: 60 }, 60)).toBe(true);
    expect(isWithinTensionWindow({ minTension: 60 }, 80)).toBe(true);
  });

  it("gates above maxTension, inclusive at the bound", () => {
    expect(isWithinTensionWindow({ maxTension: 35 }, 35)).toBe(true);
    expect(isWithinTensionWindow({ maxTension: 35 }, 35.1)).toBe(false);
  });

  it("applies both bounds together", () => {
    const def = { minTension: 40, maxTension: 79 };
    expect(isWithinTensionWindow(def, 39)).toBe(false);
    expect(isWithinTensionWindow(def, 60)).toBe(true);
    expect(isWithinTensionWindow(def, 80)).toBe(false);
  });
});
