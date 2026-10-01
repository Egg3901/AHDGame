import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { foldNotes, type ReleaseNote } from "./releaseNotes";

describe("release balance detail", () => {
  it("keeps the detailed rule, old value and scope when folding a note", () => {
    const note: ReleaseNote = {
      topic: "commons-threshold",
      title: "Commons seat eligibility",
      summary: "Fairer seat thresholds.",
      content: "## Changed\n\n- Commons threshold: 20% to 10%.\n- US House uses a separate rule.",
      date: "2026-10-01",
      tags: ["elections", "balance"],
      badges: ["patch"],
      areas: ["engine"],
    };
    const release = foldNotes([note], "Election balance.");
    expect(release).toContain("Commons threshold: 20% to 10%.");
    expect(release).toContain("US House uses a separate rule.");
    expect(release).toContain("Fairer seat thresholds.");
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { children: release }));
    for (const item of html.match(/<li>[\s\S]*?<\/li>/g) ?? []) {
      expect(item).not.toMatch(/<h[1-6][ >]/);
    }
  });
});
