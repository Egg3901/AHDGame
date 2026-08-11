import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolveLegislatedEmbargoes } from "./reconcileEmbargoes";
import type { Bill } from "@/lib/db/types";

type P = Bill["provisions"];
const bill = (
  countryId: string,
  provisions: P
): Pick<Bill, "_id" | "countryId" | "sponsorId" | "provisions"> => ({
  _id: new ObjectId(),
  countryId: countryId as Bill["countryId"],
  sponsorId: new ObjectId(),
  provisions,
});

describe("resolveLegislatedEmbargoes", () => {
  it("creates a legislation-origin embargo from an embargo provision", () => {
    const bills = [
      bill("US", [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "ordnance",
          direction: "export",
          mode: "block",
        },
      ]),
    ];
    const out = resolveLegislatedEmbargoes(bills, 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceCountry: "US",
      targetCountry: "CN",
      commodity: "ordnance",
      direction: "export",
      mode: "block",
      origin: "legislation",
      createdTurn: 100,
    });
    expect(out[0].expiresTurn).toBeUndefined(); // durable
  });

  it("repeals a matching embargo via end_embargo (later bill wins)", () => {
    const bills = [
      bill("US", [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "ordnance",
          direction: "export",
          mode: "block",
        },
      ]),
      bill("US", [
        { type: "end_embargo", targetCountry: "CN", commodity: "ordnance", direction: "export" },
      ]),
    ];
    expect(resolveLegislatedEmbargoes(bills, 100)).toHaveLength(0);
  });

  it("keeps embargoes from different countries separate", () => {
    const bills = [
      bill("US", [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "all",
          direction: "both",
          mode: "block",
        },
      ]),
      bill("DE", [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "all",
          direction: "both",
          mode: "block",
        },
      ]),
    ];
    expect(resolveLegislatedEmbargoes(bills, 100)).toHaveLength(2);
  });

  it("carries the cap for a cap-mode embargo", () => {
    const bills = [
      bill("US", [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "steel",
          direction: "export",
          mode: "cap",
          cap: 1000,
        },
      ]),
    ];
    const out = resolveLegislatedEmbargoes(bills, 100);
    expect(out[0].mode).toBe("cap");
    expect(out[0].cap).toBe(1000);
  });
});
