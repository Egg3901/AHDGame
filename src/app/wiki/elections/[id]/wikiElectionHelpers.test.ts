import { describe, expect, it } from "vitest";
import { typeLabel } from "./wikiElectionHelpers";

describe("wiki election labels", () => {
  it("humanizes a valid chamber key that is not in the gameplay label registry", () => {
    expect(typeLabel("nationalrat")).toBe("Nationalrat");
  });
});
