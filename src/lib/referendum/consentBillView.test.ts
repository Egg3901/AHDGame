import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";
import { consentBillOutcome, buildConsentBillViews } from "./consentBillView";

function bill(partial: Partial<Bill>): Bill {
  return { title: "X", countryId: "UK", votesFor: 0, votesAgainst: 0, ...partial } as Bill;
}

describe("consentBillOutcome", () => {
  it("treats a signed or enacted bill as passed", () => {
    expect(consentBillOutcome(bill({ status: "signed" }))).toBe("passed");
    expect(consentBillOutcome(bill({ status: "active", enactedAt: new Date() }))).toBe("passed");
  });

  it("treats failed/withdrawn/missing as failed", () => {
    expect(consentBillOutcome(bill({ status: "failed" }))).toBe("failed");
    expect(consentBillOutcome(bill({ status: "withdrawn" }))).toBe("failed");
    expect(consentBillOutcome(null)).toBe("failed");
    expect(consentBillOutcome(undefined)).toBe("failed");
  });

  it("treats an in-progress bill as pending", () => {
    expect(consentBillOutcome(bill({ status: "active" }))).toBe("pending");
    expect(consentBillOutcome(bill({ status: "active_other" }))).toBe("pending");
  });
});

describe("buildConsentBillViews", () => {
  it("joins ids to docs in order, names the country, and links to the bill", () => {
    const wid = new ObjectId();
    const did = new ObjectId();
    const byId = new Map<string, Bill>([
      [
        String(wid),
        bill({
          _id: wid,
          title: "SCO (Independence) Bill",
          countryId: "UK",
          status: "active",
          votesFor: 12,
          votesAgainst: 5,
        }),
      ],
      [
        String(did),
        bill({ _id: did, title: "Reunification with NI", countryId: "IE", status: "signed" }),
      ],
    ]);

    const views = buildConsentBillViews([wid, did], byId);

    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      title: "SCO (Independence) Bill",
      countryName: "United Kingdom",
      outcome: "pending",
      votesFor: 12,
      votesAgainst: 5,
      href: `/congress/bills/${String(wid)}`,
    });
    expect(views[1]).toMatchObject({ countryName: "Ireland", outcome: "passed" });
  });

  it("renders a slot for an id whose doc is missing (failed)", () => {
    const id = new ObjectId();
    const views = buildConsentBillViews([id], new Map());
    expect(views[0]).toMatchObject({ title: "Consent bill", countryName: "—", outcome: "failed" });
  });
});
