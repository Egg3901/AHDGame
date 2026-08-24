import { describe, expect, it } from "vitest";
import { withPublicNewsVisibility } from "./publicModeration";

describe("withPublicNewsVisibility", () => {
  it("requires an absent or explicitly visible moderation status", () => {
    expect(withPublicNewsVisibility({ parentId: { $exists: false } })).toEqual({
      $and: [
        { parentId: { $exists: false } },
        {
          $or: [{ moderation: { $exists: false } }, { "moderation.status": "visible" }],
        },
      ],
    });
  });
});
