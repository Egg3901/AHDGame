import { describe, it, expect } from "vitest";
import { buildWithdrawalConfirmMessage } from "./withdrawalWarning";

describe("buildWithdrawalConfirmMessage", () => {
  it("general-phase wording explicitly states votes are permanently removed (not redistributed)", () => {
    const msg = buildWithdrawalConfirmMessage("general");
    expect(msg).toMatch(/permanently/i);
    expect(msg).toMatch(/REMOVED|not\s+redistributed/i);
    expect(msg).toMatch(/cannot re-enter/i);
  });

  it("primary-phase wording omits the vote-destruction warning (no votes accumulated yet)", () => {
    const msg = buildWithdrawalConfirmMessage("primary");
    expect(msg).not.toMatch(/permanently/i);
    expect(msg).not.toMatch(/REMOVED/);
    expect(msg).toMatch(/cannot re-enter/i);
  });

  it("unknown-phase wording stays conservative and still mentions destruction", () => {
    const msg = buildWithdrawalConfirmMessage("unknown");
    expect(msg).toMatch(/permanently removed/i);
    expect(msg).toMatch(/cannot re-enter/i);
  });
});
