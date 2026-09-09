import { describe, expect, it } from "vitest";
import type { SlateRefusalReason } from "@/lib/db/types";
import {
  SLATE_FILING_FAILURE_REASONS,
  SLATE_REFUSAL_LABEL,
  isSlateFilingFailure,
} from "./slateRefusalReasons";

describe("slate refusal reasons", () => {
  it("labels a row the filing pass dropped because the race was at its cap", () => {
    const reason: SlateRefusalReason = "slate_full";
    expect(SLATE_REFUSAL_LABEL[reason]).toBe("Race Slate Full");
  });

  it("treats a cap refusal as a filing failure, not an NPP declining", () => {
    expect(isSlateFilingFailure("slate_full")).toBe(true);
  });

  it("gives every refusal reason a label", () => {
    for (const reason of SLATE_FILING_FAILURE_REASONS) {
      expect(SLATE_REFUSAL_LABEL[reason]).toBeTruthy();
    }
  });

  it("does not treat a missing reason as a filing failure", () => {
    expect(isSlateFilingFailure(null)).toBe(false);
    expect(isSlateFilingFailure(undefined)).toBe(false);
  });
});
