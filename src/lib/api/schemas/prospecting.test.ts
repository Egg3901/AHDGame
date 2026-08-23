import { describe, expect, it } from "vitest";
import { corpProspectSchema } from "./prospecting";

describe("corpProspectSchema", () => {
  it("accepts the sequential corporation IDs used by corporation pages", () => {
    const result = corpProspectSchema.safeParse({
      corporationId: "624",
      stateId: "AZ",
      resource: "rare_earth",
    });

    expect(result.success).toBe(true);
  });
});
