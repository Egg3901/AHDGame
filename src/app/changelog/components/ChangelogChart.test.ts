import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseChartSpec, MAX_SERIES } from "./ChangelogChart";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR } from "@/lib/changelog/paths";

describe("parseChartSpec", () => {
  const valid = {
    type: "bar",
    title: "T",
    categories: ["a", "b"],
    series: [{ label: "S", data: [1, 2] }],
  };

  it("accepts a well-formed spec", () => {
    const r = parseChartSpec(JSON.stringify(valid));
    expect("spec" in r).toBe(true);
  });

  it("rejects malformed JSON rather than throwing", () => {
    const r = parseChartSpec("{ not json");
    expect(r).toEqual({ error: "Chart block is not valid JSON." });
  });

  it("rejects an unknown chart type", () => {
    const r = parseChartSpec(JSON.stringify({ ...valid, type: "pie" }));
    expect("error" in r && r.error).toMatch(/"bar" or "line"/);
  });

  // The length mismatch is the easy authoring mistake: edit the categories,
  // forget one series. Silently short-rendering it would misstate the data.
  it("rejects a series whose length does not match the categories", () => {
    const r = parseChartSpec(JSON.stringify({ ...valid, series: [{ label: "S", data: [1] }] }));
    expect("error" in r && r.error).toMatch(/has 1 points but there are 2 categories/);
  });

  it("rejects non-numeric data", () => {
    const r = parseChartSpec(
      JSON.stringify({ ...valid, series: [{ label: "S", data: [1, "2"] }] })
    );
    expect("error" in r && r.error).toMatch(/array of finite numbers/);
  });

  // Past three series the validated palette can no longer guarantee separation
  // for colour-vision-deficient readers, so the spec refuses rather than
  // inventing a fourth hue.
  it("refuses more series than the palette validates for", () => {
    const many = Array.from({ length: MAX_SERIES + 1 }, (_, i) => ({
      label: `S${i}`,
      data: [1, 2],
    }));
    const r = parseChartSpec(JSON.stringify({ ...valid, series: many }));
    expect("error" in r && r.error).toMatch(/at most 3 series/);
  });

  it("rejects an empty category list", () => {
    const r = parseChartSpec(JSON.stringify({ ...valid, categories: [], series: [] }));
    expect("error" in r).toBe(true);
  });
});

/**
 * Every chart authored into shipped changelog content must parse. A chart that
 * fails renders a visible error box to the player, so this is the gate that
 * keeps one from reaching them.
 */
describe("shipped changelog content", () => {
  const fences: { file: string; index: number; raw: string }[] = [];

  for (const dir of [PUBLIC_POSTS_DIR, DEV_POSTS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const body = fs.readFileSync(path.join(dir, name), "utf-8");
      // Tolerate CRLF: the blobs are committed LF, but `core.autocrlf` checks
      // them out with CRLF on Windows, where `\n` alone matched no fence at all
      // and the suite reported zero charts to check rather than a parse failure.
      const matches = [...body.matchAll(/```chart\r?\n([\s\S]*?)```/g)];
      matches.forEach((m, i) =>
        fences.push({ file: `${path.basename(dir)}/${name}`, index: i, raw: m[1] })
      );
    }
  }

  it("has at least one chart to check", () => {
    expect(fences.length).toBeGreaterThan(0);
  });

  it.each(fences.map((f) => [`${f.file} chart #${f.index + 1}`, f.raw]))(
    "%s parses",
    (_label, raw) => {
      const result = parseChartSpec(raw as string);
      if ("error" in result) throw new Error(result.error);
      expect("spec" in result).toBe(true);
    }
  );
});
