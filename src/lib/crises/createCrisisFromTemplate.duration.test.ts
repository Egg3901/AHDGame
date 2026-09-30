import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";

const template: CrisisTemplate = {
  name: "Pandemic response",
  description: "Choose a response",
  scope: "country",
  countryIds: ["US"],
  regionIds: [],
  durationTurns: 12,
  effects: [],
  wireMessageOnStart: "Response opens",
  wireMessageOnEnd: "Response ends",
};
describe("authored global response duration", () => {
  it.each([true, false])(
    "keeps shared response pacing while retaining the standalone floor (shared: %s)",
    async (shared) => {
      const db = createMockDb();
      await createCrisisFromTemplate(db as unknown as Db, {
        template,
        scope: "country",
        countryIds: ["US"],
        regionIds: [],
        currentTurn: 48,
        ...(shared
          ? {
              globalResponse: {
                conflictKey: "pandemic",
                eventKey: "response",
                roleByCountry: { US: "belligerent" as const },
                defaultOptionIdByRole: {},
                outcomes: [],
                defaultOutcomeId: "none",
              },
            }
          : {}),
      });
      const inserted = db.collectionMocks.crises.insertOne.mock.calls[0][0];
      expect(inserted.durationTurns).toBe(shared ? 12 : 24);
    }
  );
});
