import { describe, expect, it } from "vitest";
import { buildOpsTreeView } from "./campaignView";

const tree = { starter: true, a: 2, b: 0, c: 0 };
const toLocal = (amount: number) => amount * 0.35808;

describe("campaign operation income previews", () => {
  it("quotes the next grassroots tier in the same era units as its cost", () => {
    const view = buildOpsTreeView("fundraising", tree, false, "president", false, toLocal);
    expect(view.branches[0].next?.funds).toBe(537120);
    expect(view.branches[0].next?.effect).toBe("+$644,544/turn");
    expect(view.branches[0].currentEffect).toBe("+$250,656/turn");
    expect(view.starterEffect).toBe("+$12,533/turn base income");
  });
  it("scales monetary benefits for smaller races and uses their currency", () => {
    const view = buildOpsTreeView("fundraising", tree, false, "house", false, (n) => n * 2, "£");
    expect(view.branches[0].currentEffect).toBe("+£420,000/turn");
    expect(view.branches[0].next?.effect).toBe("+£1,080,000/turn");
    expect(view.branches[1].next?.effect).toBe("+£150,000 on purchase");
    expect(view.branches[2].next?.effect).toBe("+15% income");
  });
  it("does not claim a standing grant for locked operations", () => {
    const view = buildOpsTreeView(
      "fundraising",
      { ...tree, starter: false },
      false,
      "president",
      false,
      toLocal
    );
    expect(view.branches[0].currentEffect).toBe("No effect");
    expect(view.starterCost?.effect).toBe(view.starterEffect);
  });
});
