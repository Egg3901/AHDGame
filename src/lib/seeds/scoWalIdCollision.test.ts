import { describe, it, expect } from "vitest";
import type { State } from "@/lib/db/types";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";
import { walRegions } from "@/lib/seeds/wal/walRegions";

// Every existing seeded state/region array across all countries + game-start eras.
// SCO/WAL sub-region ids must not collide with any of these (§3.3 of the SP1 spec).
import { states } from "@/lib/seeds/reference/states";
import { states1991 } from "@/lib/seeds/reference/states1991";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { jpRegions1991 } from "@/lib/seeds/jp/jpRegions1991";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { brRegions1991 } from "@/lib/seeds/br/brRegions1991";

const EXISTING: State[][] = [
  states,
  states1991,
  ukRegions,
  ukRegions1991,
  ieRegions,
  ieRegions1991,
  deRegions,
  deRegions1991,
  jpRegions,
  jpRegions1991,
  cnRegions,
  cnRegions1991,
  brRegions,
  brRegions1991,
];

describe("SCO/WAL sub-region id collisions", () => {
  const existingIds = new Set<string>(EXISTING.flat().map((r) => r._id));

  it("collides with no existing seeded state/region id across all countries + eras", () => {
    for (const r of [...scoRegions, ...walRegions]) {
      expect(existingIds.has(r._id), `${r._id} collides with an existing state id`).toBe(false);
    }
  });

  it("the SCO + WAL sub-region ids are globally unique among themselves", () => {
    const ids = [...scoRegions, ...walRegions].map((r) => r._id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
