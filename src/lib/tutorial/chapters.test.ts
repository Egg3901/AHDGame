import { describe, expect, it } from "vitest";
import {
  INTEREST_CHAPTERS,
  TUTORIAL_CHAPTERS,
  buildChapterTour,
  buildTourChapters,
  buildTourSteps,
} from "@/lib/tutorial/chapters";
import { TUTORIAL_CHAPTER_IDS, type TutorialPlan } from "@/lib/onboarding/tutorialPlan";
import { stockmarketUrl } from "@/lib/urls";

const CHARACTER = { countryId: "US" as const, homeState: "CA" };

/** Every authored step in the registry. The shared closing card is not one. */
const everyStep = () =>
  TUTORIAL_CHAPTER_IDS.flatMap((id) =>
    buildChapterTour(CHARACTER, id).filter((s) => s.id !== "tour-done")
  );

describe("step links", () => {
  it("points the market step at the actual post-redirect path", () => {
    const invest = buildChapterTour(CHARACTER, "invest").find((s) => s.id === "invest-market");

    expect(invest?.link).toBe(stockmarketUrl("US"));
    // /stockmarket/[country] is a redirect shell to /country/[code]/stockmarket
    // (see src/app/stockmarket/[country]/page.tsx). An anchored step's `link`
    // must match the URL the browser lands on post-redirect, or `onStepPage`
    // never becomes true and the spotlight and manual "Next" never appear.
    expect(invest?.link).not.toMatch(/^\/stockmarket\//);
  });

  it("never anchors a step to a page that redirects", async () => {
    // The softlock this guards: the coach decides it is "on the step page" by
    // comparing the step's link path to window.pathname. If the page at that
    // path immediately redirect()s, the browser lands somewhere else, the
    // comparison never matches, and the button stays on "Take me there" with no
    // way past. The first version of this test hardcoded two known shells and
    // missed /congress, which shipped and softlocked players on the bills step.
    // So resolve each link to its real app-router file and read it instead.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const appDir = path.resolve(__dirname, "../../app");

    /** Map a URL path to its page file, trying the literal route then [param] segments. */
    async function pageFileFor(urlPath: string): Promise<string | null> {
      const segments = urlPath.split("?")[0].split("#")[0].split("/").filter(Boolean);
      let dir = appDir;
      for (const segment of segments) {
        const literal = path.join(dir, segment);
        if (await exists(literal)) {
          dir = literal;
          continue;
        }
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const dynamic = entries.find((e) => e.isDirectory() && e.name.startsWith("["));
        if (!dynamic) return null;
        dir = path.join(dir, dynamic.name);
      }
      const page = path.join(dir, "page.tsx");
      return (await exists(page)) ? page : null;
    }

    async function exists(p: string): Promise<boolean> {
      return fs
        .stat(p)
        .then(() => true)
        .catch(() => false);
    }

    let checked = 0;
    for (const step of everyStep()) {
      if (!step.anchor || !step.link || step.external) continue;
      const file = await pageFileFor(step.link);
      expect(file, `${step.id}: no page file resolved for ${step.link}`).not.toBeNull();
      const source = await fs.readFile(file!, "utf8");
      // `redirect(` at module scope in a page component means every request to
      // this path bounces elsewhere.
      expect(
        /\bredirect\(/.test(source),
        `${step.id} links to ${step.link}, whose page redirects. The coach will never match the landed URL and the step softlocks.`
      ).toBe(false);
      checked += 1;
    }
    // Guard the guard: if the resolver silently matched nothing, the assertions
    // above would vacuously pass.
    expect(checked).toBeGreaterThan(5);
  });

  it("only uses `link` on steps that can actually advance", () => {
    // A `link` with no `anchor` and no `external` leaves the coach showing
    // "Take me there" forever, because needsNav stays true. Informational
    // links belong in `readMore`.
    for (const step of everyStep()) {
      if (!step.link) continue;
      expect(Boolean(step.anchor || step.external), `${step.id} has a dead-end link`).toBe(true);
    }
  });

  it("sends the file-for-race step to the region's Elections sub-tab", () => {
    const step = buildChapterTour(CHARACTER, "office").find((s) => s.id === "file-for-race");
    // RegionTabNav reads ?tab= and ?sub= (see resolveTabs). The country-wide
    // elections index does not show which races THIS player can enter, so the
    // step has to land on their own region with the right tab selected.
    expect(step?.link).toBe("/country/us/region/CA?tab=politics&sub=elections");
    // pathOf() strips the query, so the coach still recognises the landed page.
    expect(step?.link?.split("?")[0]).toBe("/country/us/region/CA");
  });

  it("gives every waiting step a hint", () => {
    for (const step of everyStep()) {
      if (step.waits) expect(step.hint, `${step.id} waits with no hint`).toBeTruthy();
    }
  });

  it("contains no em-dashes or en-dashes in any player-facing copy", () => {
    for (const countryId of ["US", "UK", "DE", "JP"] as const) {
      const steps = TUTORIAL_CHAPTER_IDS.flatMap((id) =>
        buildChapterTour({ countryId, homeState: "XX" }, id)
      );
      for (const step of steps) {
        expect(step.title, step.id).not.toMatch(/[–—]/);
        expect(step.body, step.id).not.toMatch(/[–—]/);
        expect(step.hint ?? "", step.id).not.toMatch(/[–—]/);
      }
    }
    for (const id of TUTORIAL_CHAPTER_IDS) {
      expect(TUTORIAL_CHAPTERS[id].title).not.toMatch(/[–—]/);
      expect(TUTORIAL_CHAPTERS[id].blurb).not.toMatch(/[–—]/);
    }
  });

  it("keeps step ids unique across the whole registry", () => {
    const ids = everyStep().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildTourChapters", () => {
  it("runs nothing for a skip plan", () => {
    expect(buildTourChapters(CHARACTER, { experience: "skip", interests: [] })).toEqual([]);
    expect(buildTourSteps(CHARACTER, { experience: "skip", interests: [] })).toEqual([]);
  });

  it("runs core plus the chosen interest, in tour order", () => {
    const plan: TutorialPlan = { experience: "new", interests: ["nation", "union"] };
    expect(buildTourChapters(CHARACTER, plan).map((c) => c.id)).toEqual([
      "core",
      "union",
      "nation",
      "whats-new",
    ]);
  });

  it("leads a returning player with what's new and drops fundamentals", () => {
    const plan: TutorialPlan = { experience: "returning", interests: ["invest"] };
    const chapters = buildTourChapters(CHARACTER, plan);
    expect(chapters.map((c) => c.id)).toEqual(["whats-new", "core", "invest"]);

    const invest = chapters.find((c) => c.id === "invest");
    expect(invest?.steps.some((s) => s.id === "invest-intro")).toBe(false);
    expect(invest?.steps.some((s) => s.id === "invest-market")).toBe(true);
  });

  it("keeps fundamentals for a new player", () => {
    const chapters = buildTourChapters(CHARACTER, { experience: "new", interests: ["invest"] });
    expect(
      chapters.find((c) => c.id === "invest")?.steps.some((s) => s.id === "invest-intro")
    ).toBe(true);
  });
});

describe("buildTourSteps", () => {
  it("tags every step with its chapter and ends with the closing card", () => {
    const steps = buildTourSteps(CHARACTER, { experience: "new", interests: ["union"] });

    expect(steps[0].chapterId).toBe("core");
    expect(steps[0].chapterIndex).toBe(0);
    expect(steps.at(-1)?.id).toBe("tour-done");
    // A new player's tour closes on what's new, so the closing card sits there.
    expect(steps.at(-1)?.chapterId).toBe("whats-new");
    expect(new Set(steps.map((s) => s.chapterIndex))).toEqual(new Set([0, 1, 2]));
  });

  it("uses country-resolved copy rather than US wording", () => {
    const uk = buildTourSteps(
      { countryId: "UK", homeState: "ENG-LON" },
      { experience: "new", interests: [] }
    );
    const scout = uk.find((s) => s.id === "scout-region");
    expect(scout?.title.toLowerCase()).not.toContain("state");
    expect(scout?.link).toContain("/country/uk/");
  });
});

describe("buildChapterTour", () => {
  it("returns one chapter at full depth regardless of experience", () => {
    const steps = buildChapterTour(CHARACTER, "invest");
    expect(steps.filter((s) => s.id !== "tour-done").every((s) => s.chapterId === "invest")).toBe(
      true
    );
    expect(steps.some((s) => s.id === "invest-intro")).toBe(true);
    expect(steps.at(-1)?.id).toBe("tour-done");
  });
});

describe("registry", () => {
  it("exposes the five interest chapters in selector order", () => {
    expect(INTEREST_CHAPTERS.map((c) => c.id)).toEqual([
      "invest",
      "company",
      "union",
      "office",
      "nation",
    ]);
  });

  it("gives every chapter a title, icon, blurb, and non-empty step list", () => {
    for (const id of TUTORIAL_CHAPTER_IDS) {
      const chapter = TUTORIAL_CHAPTERS[id];
      expect(chapter.title).toBeTruthy();
      expect(chapter.icon).toBeTruthy();
      expect(chapter.blurb).toBeTruthy();
      expect(chapter.estimatedMinutes).toBeGreaterThan(0);
      expect(buildChapterTour(CHARACTER, id).length).toBeGreaterThan(1);
    }
  });
});
