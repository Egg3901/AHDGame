import { expect, it } from "vitest";
import type { Db } from "mongodb";
import { computePartyOrgMap } from "./partyOrgService";

it("supplies the display name separately from the party id for map charts and tables", async () => {
  const db = {
    collection: (name: string) => ({
      find: () => ({
        toArray: async () =>
          name === "politicalParties"
            ? [{ sequentialId: 7, name: "Example Party", color: "#123456" }]
            : [{ stateId: "CA", partyId: "7", organization: 20 }],
      }),
    }),
  } as unknown as Db;
  const result = await computePartyOrgMap(db, "US");
  expect(result.CA).toMatchObject({
    leadingParty: "7",
    leadingPartyName: "Example Party",
    organization: 20,
  });
});
