import { describe, expect, it } from "vitest";
import { HELD_MIGRATIONS, MIGRATIONS } from "./registry";

describe("MIGRATIONS", () => {
  it("includes all index-fund bootstrap migrations in order", () => {
    const ids = MIGRATIONS.map((migration) => migration.id);

    expect(ids).toContain("2026-06-01-index-fund-foundation");
    expect(ids).toContain("2026-06-01-index-fund-seed");
    expect(ids).toContain("2026-06-02-index-fund-real-bonds");
    expect(ids).toContain("2026-10-04-political-media-order-indexes");
    expect(ids).toContain("2026-10-04-government-accountability");
    expect(ids).toContain("2026-06-06-route-performance-indexes");
    expect(ids.indexOf("2026-06-02-index-fund-real-bonds")).toBeGreaterThan(
      ids.indexOf("2026-06-01-index-fund-seed")
    );
    expect(ids.indexOf("2026-06-06-route-performance-indexes")).toBeGreaterThan(
      ids.indexOf("2026-06-02-index-fund-real-bonds")
    );
  });

  it("keeps the live Demographics v2 promotion outside the automatic chain", () => {
    const id = "2026-10-07-activate-live-demographics-v2";

    expect(MIGRATIONS.map((migration) => migration.id)).not.toContain(id);
    expect(HELD_MIGRATIONS.map((migration) => migration.id)).toContain(id);
  });
});
