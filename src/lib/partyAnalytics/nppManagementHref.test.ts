import { describe, expect, it } from "vitest";
import { buildNppManagementHref } from "./discipline";

describe("analytics management links", () => {
  it("opens national management with the NPP and its home region", () => {
    expect(buildNppManagementHref("UK", "4", "abc", "LON")).toBe(
      "/country/uk/parties/4?tab=actions&sub=management&state=LON&npp=abc"
    );
  });
  it("keeps state leadership in its own management scope", () => {
    expect(buildNppManagementHref("US", "4", "abc", "CA", "CA")).toBe(
      "/country/us/region/CA/party/4?tab=actions&sub=management&state=CA&npp=abc"
    );
  });
});
