import { describe, expect, it } from "vitest";
import { WIKI_GLOSSARY } from "./glossary";
import { compileGlossary, splitGlossaryHits } from "@/lib/wiki/glossaryHighlight";

describe("WIKI_GLOSSARY", () => {
  it("covers the requested jargon set", () => {
    const keys = Object.keys(WIKI_GLOSSARY);
    for (const term of [
      "AP",
      "PI",
      "cloture",
      "favorability",
      "appeal",
      "lean",
      "era",
      "bloc",
      "SOE",
      "extraction",
      "apportionment",
      "ministerial actions",
      "SED",
      "National Front",
      "command economy",
      "FOMC",
      "world events",
      "SCOTUS",
    ]) {
      expect(keys).toContain(term);
    }
  });

  it("has no em or en dashes in definitions", () => {
    for (const [key, entry] of Object.entries(WIKI_GLOSSARY)) {
      expect(entry.definition, key).not.toMatch(/[—–]/);
    }
  });
});

describe("splitGlossaryHits", () => {
  const compiled = compileGlossary(WIKI_GLOSSARY);

  it("wraps only the first occurrence of a canonical term per used set", () => {
    const used = new Set<string>();
    const first = splitGlossaryHits("Spend PI, then spend more PI later.", used, compiled);
    const terms = first.filter((h) => h.type === "term");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ type: "term", canonical: "PI", value: "PI" });

    const second = splitGlossaryHits("Another PI mention.", used, compiled);
    expect(second.filter((h) => h.type === "term")).toHaveLength(0);
  });

  it("matches aliases onto the same canonical key", () => {
    const used = new Set<string>();
    const hits = splitGlossaryHits(
      "Build political influence before you spend PI.",
      used,
      compiled
    );
    const terms = hits.filter((h) => h.type === "term");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ canonical: "PI" });
    expect(used.has("PI")).toBe(true);
  });

  it("does not match AP inside longer tokens like MAP", () => {
    const used = new Set<string>();
    const hits = splitGlossaryHits("Open the MAP screen.", used, compiled);
    expect(hits.filter((h) => h.type === "term" && h.canonical === "AP")).toHaveLength(0);
  });

  it("prefers the longer phrase when two terms overlap", () => {
    const used = new Set<string>();
    const hits = splitGlossaryHits(
      "National Political Influence (NPI) grows from PI.",
      used,
      compiled
    );
    const terms = hits.filter((h) => h.type === "term");
    const canonicals = terms.map((t) => t.canonical);
    expect(canonicals).toContain("NPI");
    expect(canonicals).toContain("PI");
  });
});
