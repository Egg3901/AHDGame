import { describe, expect, it } from "vitest";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";

describe("region seed state-id uniqueness across countries", () => {
  it("no two countries share a state _id (HB-style collision guard)", () => {
    const sets: [string, { _id: string }[]][] = [
      ["DE", deRegions],
      ["CN", cnRegions],
      ["JP", jpRegions],
      ["IE", ieRegions],
      ["BR", brRegions],
      ["UK", ukRegions],
    ];
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [cc, regions] of sets)
      for (const r of regions) {
        if (seen.has(r._id)) collisions.push(`${r._id}: ${seen.get(r._id)} vs ${cc}`);
        else seen.set(r._id, cc);
      }
    expect(collisions).toEqual([]);
  });
});
