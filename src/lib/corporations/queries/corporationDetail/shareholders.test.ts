import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { buildShareholderList, type ShareholderContext } from "./shareholders";
import { purchasedHoldingTerms } from "@/lib/corporations/rules/holdingTerms";
describe("holding-term disclosure", () => {
  it("shows ages and basis only to the owning account, including imperial holdings", () => {
    const own = new ObjectId(),
      other = new ObjectId(),
      imperial = new ObjectId();
    const corp = {
      _id: new ObjectId(),
      ceoId: own,
      totalShares: 30,
      publicFloat: 0,
      shareholders: [
        { characterId: own, shares: 10, holdingTerms: purchasedHoldingTerms(10, 3, 10) },
        { characterId: other, shares: 10, holdingTerms: purchasedHoldingTerms(10, 7, 12) },
        {
          imperialCharacterId: imperial,
          shares: 10,
          holdingTerms: purchasedHoldingTerms(10, 5, 10),
        },
      ],
    } as unknown as Corporation;
    const context = {
      isImperialCeo: false,
      ceo: null,
      shareholderNameMap: new Map([
        [own.toHexString(), { name: "Own", userId: "owner" }],
        [other.toHexString(), { name: "Other", userId: "stranger" }],
        [imperial.toHexString(), { name: "Imperial", userId: "owner", isImperial: true }],
      ]),
      corporationShareholderNameMap: new Map(),
      nppShareholderNameMap: new Map(),
      fundShareholderNameMap: new Map(),
      corpBorderMap: new Map(),
    } as unknown as ShareholderContext;
    const input = {
      corporationForControl: corp,
      corporation: corp,
      shareholderCtx: context,
      openListingsForInvariant: [],
      openSellOrdersForInvariant: [],
      totalShares: 30,
      currentTurn: 58,
    };
    const rows = buildShareholderList({ ...input, viewerUserId: "owner" });
    expect(rows.find((row) => row.characterId === own.toHexString())!.holdingTerms).toEqual({
      longTermShares: 10,
      longTermCostBasisAnchor: 30,
      shortTermLots: [],
    });
    expect(
      rows.find((row) => row.characterId === imperial.toHexString())!.holdingTerms
    ).toBeDefined();
    expect(
      rows.find((row) => row.characterId === other.toHexString())!.holdingTerms
    ).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("userId");
    expect(buildShareholderList(input).every((row) => row.holdingTerms === undefined)).toBe(true);
  });
});
