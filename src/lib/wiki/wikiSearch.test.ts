import { describe, it, expect } from "vitest";
import { rankWikiSearchCandidates, type WikiSearchCandidate } from "./wikiSearch";

function candidate(partial: Partial<WikiSearchCandidate> & { title: string }): WikiSearchCandidate {
  return {
    slug: partial.title.toLowerCase().replace(/\s+/g, "-"),
    href: `/wiki/${partial.title.toLowerCase().replace(/\s+/g, "-")}`,
    kind: "page",
    ...partial,
  };
}

describe("rankWikiSearchCandidates", () => {
  it("ranks an exact title match above a page that only mentions the term in its content", () => {
    const results = rankWikiSearchCandidates(
      "filibuster",
      [
        candidate({ title: "Senate Procedure", matchedBody: true }),
        candidate({ title: "Filibuster" }),
      ],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Filibuster", "Senate Procedure"]);
  });

  it("ranks a title prefix match above a mid-title match", () => {
    const results = rankWikiSearchCandidates(
      "party",
      [candidate({ title: "Third Party Rules" }), candidate({ title: "Party Finance" })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Party Finance", "Third Party Rules"]);
  });

  it("ranks a description match above a content match", () => {
    const results = rankWikiSearchCandidates(
      "cloture",
      [
        candidate({ title: "Alpha", matchedBody: true }),
        candidate({ title: "Beta", description: "cloture appears in the description" }),
      ],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Beta", "Alpha"]);
  });

  it("applies the limit after ranking, not before", () => {
    const results = rankWikiSearchCandidates(
      "budget",
      [
        candidate({ title: "Zoning Law", matchedBody: true }),
        candidate({ title: "Appropriations", matchedBody: true }),
        candidate({ title: "Budget" }),
      ],
      1
    );

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Budget");
  });

  it("excludes candidates that do not match the query at all", () => {
    const results = rankWikiSearchCandidates(
      "tariff",
      [candidate({ title: "Tariff Policy" }), candidate({ title: "Unrelated Page" })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Tariff Policy"]);
  });

  it("breaks ties alphabetically by title", () => {
    const results = rankWikiSearchCandidates(
      "reform",
      [candidate({ title: "Reform Zeta" }), candidate({ title: "Reform Alpha" })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Reform Alpha", "Reform Zeta"]);
  });

  it("returns every candidate alphabetically when the query is empty", () => {
    const results = rankWikiSearchCandidates(
      "",
      [candidate({ title: "Zeta" }), candidate({ title: "Alpha" })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Alpha", "Zeta"]);
  });

  it("matches case-insensitively", () => {
    const results = rankWikiSearchCandidates("SENATE", [candidate({ title: "senate" })], 10);

    expect(results.map((r) => r.title)).toEqual(["senate"]);
  });

  it("preserves href and kind so non-page surfaces stay navigable", () => {
    const results = rankWikiSearchCandidates(
      "labour",
      [candidate({ title: "Labour Party", href: "/wiki/party/abc123", kind: "party" })],
      10
    );

    expect(results[0].href).toBe("/wiki/party/abc123");
    expect(results[0].kind).toBe("party");
  });

  it("scores a source-confirmed body match at the content tier without needing the body text", () => {
    const results = rankWikiSearchCandidates(
      "tariff",
      [candidate({ title: "Zeta", matchedBody: true }), candidate({ title: "Tariff Policy" })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Tariff Policy", "Zeta"]);
  });

  it("keeps a source-confirmed body match ahead of a non-match", () => {
    const results = rankWikiSearchCandidates(
      "tariff",
      [candidate({ title: "Unrelated" }), candidate({ title: "Body Hit", matchedBody: true })],
      10
    );

    expect(results.map((r) => r.title)).toEqual(["Body Hit"]);
  });

  it("drops the matchedBody flag from the returned result", () => {
    const results = rankWikiSearchCandidates(
      "tariff",
      [candidate({ title: "Body Hit", matchedBody: true })],
      10
    );

    expect(results[0]).not.toHaveProperty("matchedBody");
  });
});
