import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetEventHandlerRegistryForTests,
  getDefaultOptionId,
  getEventHandler,
  registerEventHandler,
} from "./registry";
import type { EventHandler } from "./types";

const sampleHandler: EventHandler = {
  kind: "pree.test",
  defaultOptionId: "ignore",
  options: [
    {
      id: "ignore",
      label: "Ignore",
      description: "Do nothing",
      isDefault: true,
      outcomeTable: [{ minRoll: 1, maxRoll: 100, label: "noop", effects: [] }],
    },
  ],
};

describe("event substrate registry", () => {
  beforeEach(() => {
    _resetEventHandlerRegistryForTests();
  });

  it("registers and retrieves handlers", () => {
    registerEventHandler(sampleHandler);
    expect(getEventHandler("pree.test")).toBe(sampleHandler);
    expect(getDefaultOptionId("pree.test")).toBe("ignore");
  });

  it("rejects handlers with invalid outcome tables", () => {
    expect(() =>
      registerEventHandler({
        ...sampleHandler,
        options: [
          {
            id: "bad",
            label: "Bad",
            description: "Bad table",
            outcomeTable: [{ minRoll: 1, maxRoll: 50, label: "half", effects: [] }],
          },
        ],
      })
    ).toThrow(/ends at 50/i);
  });
});
