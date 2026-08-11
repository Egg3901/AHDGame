import { describe, it, expect } from "vitest";
import { orgAccentStyle } from "./orgTheme";
import { BUILTIN_ORG_IDENTITY } from "@/lib/constants/orgIdentity";

describe("orgAccentStyle", () => {
  it("maps an identity to --org / --org-soft CSS vars", () => {
    const style = orgAccentStyle(BUILTIN_ORG_IDENTITY.UN) as Record<string, string>;
    expect(style["--org"]).toBe("#5b92e5");
    expect(style["--org-soft"]).toBe("#a9c9f5");
  });
});
