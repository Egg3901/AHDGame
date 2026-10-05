import {
  budgetUrl,
  cabinetUrl,
  centralBankUrl,
  countryElectionsUrl,
  economyUrl,
  executiveUrl,
  partiesUrl,
  regionElectionsUrl,
  regionUrl,
  stockmarketUrl,
  unionsUrl,
} from "@/lib/urls";
import {
  TUTORIAL_CHAPTER_IDS,
  chapterIdsForPlan,
  stepVisibleForExperience,
  type TutorialChapterId,
  type TutorialInterest,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";
import { DEFAULT_TUTORIAL_WORLD, type TutorialWorld } from "@/lib/tutorial/world";
import {
  COMMUNITY_DISCORD_URL,
  coachCountryContext,
  type CoachCountryContext,
  type CoachCharacter,
  type CoachStep,
  type TourStep,
} from "@/lib/tutorial/coachSteps";

/**
 * Tutorial chapters — the content the guided tour is assembled from.
 *
 * A chapter is one answer to "what do you want to do", plus the always-on
 * `core` chapter and the returning-player `whats-new` chapter. The player's
 * plan (see tutorialPlan.ts) picks which chapters run and in what order; this
 * module turns that into a flat, country-resolved list of steps for the coach
 * and a chapter summary for the selector and the /tutorial hub.
 *
 * Chapters are the single source of chapter structure: the welcome-flow cards,
 * the hub, and the coach's chapter rail all read the same registry.
 *
 * Copy fields (`title`, `body`, `hint`, `next`, `blurb`, `readMore.label`)
 * hold message keys under the "tutorial" namespace, not literal text. The
 * rendering components resolve them with useTranslations("tutorial"), passing
 * the country context (countryName, region, legislatureName) as ICU values, so
 * the English source lives in messages/en/tutorial.json alongside every other
 * locale. Ids, links, anchors, and signals stay literal here.
 */

export interface TutorialChapter {
  id: TutorialChapterId;
  /** Message key for the chapter title, under the "tutorial" namespace. */
  title: string;
  /** Message key: one line, shown on the selector card and the hub. */
  blurb: string;
  /** Per-edition blurb override, for a chapter whose content changes by world. */
  blurbByEdition?: Partial<Record<TutorialWorld["edition"], string>>;
  /** Rough reading/doing time, so the player can choose informed. */
  estimatedMinutes: number;
  /** Wiki learning path with the long version, if one covers this ground. */
  wikiPathSlug?: string;
  buildSteps: (ctx: CoachCountryContext) => CoachStep[];
}

/* ------------------------------------------------------------------ */
/* what's new: last for new players, first for returning ones          */
/* ------------------------------------------------------------------ */

/**
 * Curated highlights of the current world, one edition per world launch. Keep
 * each edition to about six cards and write a NEW edition for each launch (copy
 * lives in the tutorial catalogs); it does not derive from the changelog at run
 * time. The edition is picked from the world's preset (see world.ts), so a world
 * that has not been reset yet keeps the cards that are true for it.
 *
 *   "1991":    against the 1953 world. Sources: changelog 1.12.0 and the 1991
 *              explorer's "versus 1953" list.
 *   "general": the 1.0.0 launch cards, for every other preset.
 *
 * Runs for everyone, but placement differs (see chapterIdsForPlan): first for a
 * returning player, because it is the only reason they opened the tutorial, and
 * last for a new one, who needs the fundamentals before "what changed" means
 * anything.
 */
function whatsNewSteps(ctx: CoachCountryContext): CoachStep[] {
  return ctx.world.edition === "1991" ? whatsNew1991Steps(ctx) : whatsNewGeneralSteps(ctx);
}

function whatsNew1991Steps(ctx: CoachCountryContext): CoachStep[] {
  const steps: CoachStep[] = [
    {
      id: "whats-new-1991-intro",
      title: "steps.whatsNew1991Intro.title",
      body: "steps.whatsNew1991Intro.body",
      next: "steps.whatsNew1991Intro.next",
    },
    {
      id: "whats-new-1991-fresh-start",
      title: "steps.whatsNew1991FreshStart.title",
      body: "steps.whatsNew1991FreshStart.body",
      next: "steps.whatsNew1991FreshStart.next",
    },
    {
      id: "whats-new-1991-world",
      title: "steps.whatsNew1991World.title",
      body: "steps.whatsNew1991World.body",
      readMore: { label: "steps.whatsNew1991World.readMore", href: "/world/crises" },
      next: "steps.whatsNew1991World.next",
    },
  ];
  if (ctx.world.noStartingParties) {
    steps.push({
      id: "whats-new-1991-parties",
      title: "steps.whatsNew1991Parties.title",
      body: "steps.whatsNew1991Parties.body",
      readMore: { label: "steps.whatsNew1991Parties.readMore", href: partiesUrl(ctx.countryId) },
      next: "steps.whatsNew1991Parties.next",
    });
  }
  steps.push(
    {
      id: "whats-new-1991-founding",
      title: "steps.whatsNew1991Founding.title",
      body: "steps.whatsNew1991Founding.body",
      readMore: {
        label: "steps.whatsNew1991Founding.readMore",
        href: countryElectionsUrl(ctx.countryId),
      },
      next: "steps.whatsNew1991Founding.next",
    },
    {
      id: "whats-new-1991-prices",
      title: "steps.whatsNew1991Prices.title",
      body: "steps.whatsNew1991Prices.body",
      next: "steps.whatsNew1991Prices.next",
    },
    {
      id: "whats-new-1991-economy",
      title: "steps.whatsNew1991Economy.title",
      body: "steps.whatsNew1991Economy.body",
      readMore: { label: "steps.whatsNew1991Economy.readMore", href: economyUrl(ctx.countryId) },
      next: "steps.whatsNew1991Economy.next",
    }
  );
  return steps;
}

function whatsNewGeneralSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "whats-new-intro",
      title: "steps.whatsNewIntro.title",
      body: "steps.whatsNewIntro.body",
      next: "steps.whatsNewIntro.next",
    },
    {
      id: "whats-new-founding",
      title: "steps.whatsNewFounding.title",
      body: "steps.whatsNewFounding.body",
      next: "steps.whatsNewFounding.next",
    },
    {
      id: "whats-new-unions",
      title: "steps.whatsNewUnions.title",
      body: "steps.whatsNewUnions.body",
      readMore: { label: "steps.whatsNewUnions.readMore", href: unionsUrl(ctx.countryId) },
      next: "steps.whatsNewUnions.next",
    },
    {
      id: "whats-new-households",
      title: "steps.whatsNewHouseholds.title",
      body: "steps.whatsNewHouseholds.body",
      readMore: { label: "steps.whatsNewHouseholds.readMore", href: economyUrl(ctx.countryId) },
      next: "steps.whatsNewHouseholds.next",
    },
    {
      id: "whats-new-ai",
      title: "steps.whatsNewAi.title",
      body: "steps.whatsNewAi.body",
      next: "steps.whatsNewAi.next",
    },
    {
      id: "whats-new-elections",
      title: "steps.whatsNewElections.title",
      body: "steps.whatsNewElections.body",
      readMore: {
        label: "steps.whatsNewElections.readMore",
        href: countryElectionsUrl(ctx.countryId),
      },
      next: "steps.whatsNewElections.next",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* core — everyone                                                     */
/* ------------------------------------------------------------------ */

function coreSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "welcome",
      title: "steps.welcome.title",
      body: "steps.welcome.body",
      facts: ["turn"],
      next: "steps.welcome.next",
      fundamental: true,
    },
    {
      id: "how-turns-work",
      title: "steps.howTurnsWork.title",
      body: "steps.howTurnsWork.body",
      facts: ["turn", "wallet"],
      next: "steps.howTurnsWork.next",
      fundamental: true,
    },
    // Only while the founding round runs. Not fundamental: a returning player
    // needs the dates as much as a new one.
    ...(ctx.world.founding
      ? [
          {
            id: "founding-round",
            title: "steps.foundingRound.title",
            body: "steps.foundingRound.body",
            readMore: {
              label: "steps.foundingRound.readMore",
              href: regionElectionsUrl(ctx.countryId, ctx.homeState),
            },
            facts: ["turn", "openSeats"],
            next: "steps.foundingRound.next",
          } satisfies CoachStep,
        ]
      : []),
    {
      id: "join-discord",
      title: "steps.joinDiscord.title",
      body: "steps.joinDiscord.body",
      link: COMMUNITY_DISCORD_URL,
      external: true,
      next: "steps.joinDiscord.next",
    },
    {
      id: "scout-region",
      title: "steps.scoutRegion.title",
      body: "steps.scoutRegion.body",
      hint: "steps.scoutRegion.hint",
      anchor: "nav-region",
      link: regionUrl(ctx.countryId, ctx.homeState),
      facts: ["region", "regionEconomy"],
      next: "steps.scoutRegion.next",
      waits: true,
    },
    {
      id: "read-wire",
      title: "steps.readWire.title",
      body: "steps.readWire.body",
      hint: "steps.readWire.hint",
      anchor: "nav-news",
      link: "/news",
      next: "steps.readWire.next",
      waits: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* office                                                              */
/* ------------------------------------------------------------------ */

function officeSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "office-intro",
      title: "steps.officeIntro.title",
      body: "steps.officeIntro.body",
      facts: ["parties"],
      next: "steps.officeIntro.next",
      fundamental: true,
    },
    // A world opened with no parties has nothing to join on day one, so the
    // step becomes "join one players built, or found your own". Same slot,
    // same signal: joining or ratifying a charter both put you in a party.
    ctx.world.noStartingParties
      ? {
          id: "found-party",
          title: "steps.foundParty.title",
          body: "steps.foundParty.body",
          hint: "steps.foundParty.hint",
          anchor: "nav-parties",
          link: partiesUrl(ctx.countryId),
          facts: ["parties"],
          next: "steps.foundParty.next",
          waits: true,
          advanceSignal: "party",
        }
      : {
          id: "join-party",
          title: "steps.joinParty.title",
          body: "steps.joinParty.body",
          hint: "steps.joinParty.hint",
          anchor: "nav-parties",
          link: partiesUrl(ctx.countryId),
          facts: ["parties"],
          next: "steps.joinParty.next",
          waits: true,
          advanceSignal: "party",
        },
    {
      id: "actions-what",
      title: "steps.actionsWhat.title",
      body: "steps.actionsWhat.body",
      hint: "steps.actionsWhat.hint",
      anchor: "nav-actions",
      link: "/actions",
      facts: ["wallet"],
      next: "steps.actionsWhat.next",
      fundamental: true,
    },
    {
      id: "action-campaign",
      title: "steps.actionCampaign.title",
      body: "steps.actionCampaign.body",
      hint: "steps.actionCampaign.hint",
      anchor: "action-campaign",
      link: "/actions",
      facts: ["wallet"],
      next: "steps.actionCampaign.next",
      waits: true,
      advanceSignal: "campaign",
    },
    {
      id: "action-advertise",
      title: "steps.actionAdvertise.title",
      body: "steps.actionAdvertise.body",
      anchor: "action-advertise",
      link: "/actions",
      next: "steps.actionAdvertise.next",
    },
    {
      id: "action-fundraise",
      title: "steps.actionFundraise.title",
      body: "steps.actionFundraise.body",
      anchor: "action-fundraise",
      link: "/actions",
      next: "steps.actionFundraise.next",
    },
    {
      id: "action-donors",
      title: "steps.actionDonors.title",
      body: "steps.actionDonors.body",
      anchor: "action-buildDonorBase",
      link: "/actions",
      next: "steps.actionDonors.next",
    },
    {
      id: "file-for-race",
      title: "steps.fileForRace.title",
      body: "steps.fileForRace.body",
      hint: "steps.fileForRace.hint",
      anchor: "nav-races",
      link: regionElectionsUrl(ctx.countryId, ctx.homeState),
      facts: ["openSeats"],
      next: "steps.fileForRace.next",
      waits: true,
      advanceSignal: "candidacy",
    },
    {
      id: "first-vote",
      title: "steps.firstVote.title",
      body: "steps.firstVote.body",
      hint: "steps.firstVote.hint",
      anchor: "nav-legislature",
      link: ctx.legislatureLink,
      next: "steps.firstVote.next",
      waits: true,
      advanceSignal: "vote",
    },
    {
      id: "office-wider",
      title: "steps.officeWider.title",
      body: "steps.officeWider.body",
      readMore: { label: "steps.officeWider.readMore", href: countryElectionsUrl(ctx.countryId) },
      next: "steps.officeWider.next",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* invest                                                              */
/* ------------------------------------------------------------------ */

function investSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "invest-intro",
      title: "steps.investIntro.title",
      body: "steps.investIntro.body",
      next: "steps.investIntro.next",
      fundamental: true,
    },
    {
      id: "invest-market",
      title: "steps.investMarket.title",
      body: "steps.investMarket.body",
      hint: "steps.investMarket.hint",
      anchor: "nav-stockmarket",
      link: stockmarketUrl(ctx.countryId),
      facts: ["wallet"],
      next: "steps.investMarket.next",
      waits: true,
      advanceSignal: "invest",
    },
    {
      id: "invest-portfolio",
      title: "steps.investPortfolio.title",
      body: "steps.investPortfolio.body",
      hint: "steps.investPortfolio.hint",
      anchor: "nav-portfolio",
      link: "/portfolio",
      next: "steps.investPortfolio.next",
      waits: true,
    },
    {
      id: "invest-risk",
      title: "steps.investRisk.title",
      body: "steps.investRisk.body",
      next: "steps.investRisk.next",
      fundamental: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* company                                                             */
/* ------------------------------------------------------------------ */

function companySteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "company-intro",
      title: "steps.companyIntro.title",
      body: "steps.companyIntro.body",
      next: "steps.companyIntro.next",
      fundamental: true,
    },
    {
      id: "company-take-charge",
      title: "steps.companyTakeCharge.title",
      body: "steps.companyTakeCharge.body",
      hint: "steps.companyTakeCharge.hint",
      anchor: "nav-corporations",
      link: stockmarketUrl(ctx.countryId),
      facts: ["companies"],
      next: "steps.companyTakeCharge.next",
      waits: true,
      advanceSignal: "company",
    },
    {
      id: "company-sectors",
      title: "steps.companySectors.title",
      body: "steps.companySectors.body",
      next: "steps.companySectors.next",
      fundamental: true,
    },
    {
      id: "company-labour",
      title: "steps.companyLabour.title",
      body: "steps.companyLabour.body",
      readMore: { label: "steps.companyLabour.readMore", href: economyUrl(ctx.countryId) },
      next: "steps.companyLabour.next",
    },
    {
      id: "company-shares",
      title: "steps.companyShares.title",
      body: "steps.companyShares.body",
      next: "steps.companyShares.next",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* union                                                               */
/* ------------------------------------------------------------------ */

function unionSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "union-intro",
      title: "steps.unionIntro.title",
      body: "steps.unionIntro.body",
      next: "steps.unionIntro.next",
      fundamental: true,
    },
    {
      id: "union-find",
      title: "steps.unionFind.title",
      body: "steps.unionFind.body",
      hint: "steps.unionFind.hint",
      anchor: "nav-unions",
      link: unionsUrl(ctx.countryId),
      facts: ["unions"],
      next: "steps.unionFind.next",
      waits: true,
      advanceSignal: "union",
    },
    {
      id: "union-organize",
      title: "steps.unionOrganize.title",
      body: "steps.unionOrganize.body",
      readMore: { label: "steps.unionOrganize.readMore", href: unionsUrl(ctx.countryId) },
      next: "steps.unionOrganize.next",
    },
    {
      id: "union-power",
      title: "steps.unionPower.title",
      body: "steps.unionPower.body",
      next: "steps.unionPower.next",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* nation                                                              */
/* ------------------------------------------------------------------ */

function nationSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "nation-intro",
      title: "steps.nationIntro.title",
      body: "steps.nationIntro.body",
      next: "steps.nationIntro.next",
      fundamental: true,
    },
    {
      id: "nation-executive",
      title: "steps.nationExecutive.title",
      body: "steps.nationExecutive.body",
      readMore: { label: "steps.nationExecutive.readMore", href: executiveUrl(ctx.countryId) },
      next: "steps.nationExecutive.next",
    },
    {
      id: "nation-cabinet",
      title: "steps.nationCabinet.title",
      body: "steps.nationCabinet.body",
      readMore: { label: "steps.nationCabinet.readMore", href: cabinetUrl(ctx.countryId) },
      next: "steps.nationCabinet.next",
    },
    {
      id: "nation-budget",
      title: "steps.nationBudget.title",
      body: "steps.nationBudget.body",
      hint: "steps.nationBudget.hint",
      anchor: "nav-budget",
      link: budgetUrl(ctx.countryId),
      next: "steps.nationBudget.next",
      waits: true,
    },
    {
      id: "nation-money",
      title: "steps.nationMoney.title",
      body: "steps.nationMoney.body",
      readMore: { label: "steps.nationMoney.readMore", href: centralBankUrl(ctx.countryId) },
      next: "steps.nationMoney.next",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

export const TUTORIAL_CHAPTERS: Record<TutorialChapterId, TutorialChapter> = {
  "whats-new": {
    id: "whats-new",
    title: "chapters.whatsNew.title",
    blurb: "chapters.whatsNew.blurb",
    blurbByEdition: { "1991": "chapters.whatsNew.blurb1991" },
    estimatedMinutes: 4,
    buildSteps: whatsNewSteps,
  },
  core: {
    id: "core",
    title: "chapters.core.title",
    blurb: "chapters.core.blurb",
    estimatedMinutes: 4,
    wikiPathSlug: "new-player",
    buildSteps: coreSteps,
  },
  office: {
    id: "office",
    title: "chapters.office.title",
    blurb: "chapters.office.blurb",
    estimatedMinutes: 7,
    wikiPathSlug: "running-for-office",
    buildSteps: officeSteps,
  },
  invest: {
    id: "invest",
    title: "chapters.invest.title",
    blurb: "chapters.invest.blurb",
    estimatedMinutes: 4,
    wikiPathSlug: "economy-operator",
    buildSteps: investSteps,
  },
  company: {
    id: "company",
    title: "chapters.company.title",
    blurb: "chapters.company.blurb",
    estimatedMinutes: 6,
    wikiPathSlug: "economy-operator",
    buildSteps: companySteps,
  },
  union: {
    id: "union",
    title: "chapters.union.title",
    blurb: "chapters.union.blurb",
    estimatedMinutes: 5,
    buildSteps: unionSteps,
  },
  nation: {
    id: "nation",
    title: "chapters.nation.title",
    blurb: "chapters.nation.blurb",
    estimatedMinutes: 6,
    wikiPathSlug: "advanced-strategy",
    buildSteps: nationSteps,
  },
};

/** The five interest chapters, in the order the welcome-flow selector shows them. */
export const INTEREST_CHAPTERS: TutorialChapter[] = (
  ["invest", "company", "union", "office", "nation"] satisfies TutorialInterest[]
).map((id) => TUTORIAL_CHAPTERS[id]);

/** The blurb message key for this chapter in this world. */
export function chapterBlurb(chapter: TutorialChapter, world: TutorialWorld): string {
  return chapter.blurbByEdition?.[world.edition] ?? chapter.blurb;
}

/**
 * Rough minutes for a plan's whole tour, for the welcome flow's estimate. Reads
 * the same chapter list the tour runs, so it counts "what changed" and the core
 * chapter instead of a hardcoded allowance.
 */
export function estimateTourMinutes(plan: TutorialPlan): number {
  return chapterIdsForPlan(plan).reduce(
    (total, id) => total + TUTORIAL_CHAPTERS[id].estimatedMinutes,
    0
  );
}

/** Guard so a stored progress chapterId from an older build cannot crash a render. */
export function getChapter(id: string): TutorialChapter | undefined {
  return (TUTORIAL_CHAPTER_IDS as readonly string[]).includes(id)
    ? TUTORIAL_CHAPTERS[id as TutorialChapterId]
    : undefined;
}

export interface ResolvedChapter extends TutorialChapter {
  steps: CoachStep[];
}

/**
 * The chapters this plan runs, country-resolved, with steps already filtered by
 * experience level. Chapters left with no steps are dropped so the rail never
 * shows an empty dot.
 */
export function buildTourChapters(
  character: CoachCharacter,
  plan: TutorialPlan,
  world: TutorialWorld = DEFAULT_TUTORIAL_WORLD
): ResolvedChapter[] {
  const ctx = coachCountryContext(character, world);
  return chapterIdsForPlan(plan)
    .map((id) => {
      const chapter = TUTORIAL_CHAPTERS[id];
      return {
        ...chapter,
        steps: chapter
          .buildSteps(ctx)
          .filter((step) => stepVisibleForExperience(step, plan.experience)),
      };
    })
    .filter((chapter) => chapter.steps.length > 0);
}

/** Closing card, appended once at the end of any non-empty tour. */
function closingStep(chapterCount: number): CoachStep {
  return {
    id: "tour-done",
    title: "closing.title",
    body: chapterCount > 2 ? "closing.bodyFull" : "closing.bodyShort",
    next: "closing.next",
  };
}

/**
 * The player's whole tour as one flat step list, each step tagged with the
 * chapter it came from so the coach can draw its rail and jump between
 * chapters. Empty for a plan whose experience is "skip".
 */
export function buildTourSteps(
  character: CoachCharacter,
  plan: TutorialPlan,
  world: TutorialWorld = DEFAULT_TUTORIAL_WORLD
): TourStep[] {
  const chapters = buildTourChapters(character, plan, world);
  if (chapters.length === 0) return [];

  const steps: TourStep[] = chapters.flatMap((chapter, chapterIndex) =>
    chapter.steps.map((step) => ({
      ...step,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterIndex,
    }))
  );

  const last = chapters[chapters.length - 1];
  steps.push({
    ...closingStep(chapters.length),
    chapterId: last.id,
    chapterTitle: last.title,
    chapterIndex: chapters.length - 1,
  });
  return steps;
}

/**
 * One chapter on its own, for "replay this chapter" on the hub.
 *
 * Always built at full depth (every fundamental included) regardless of the
 * player's experience level: someone who deliberately asks to replay a chapter
 * wants the whole thing, not the abbreviated returning-player cut.
 */
export function buildChapterTour(
  character: CoachCharacter,
  chapterId: TutorialChapterId,
  world: TutorialWorld = DEFAULT_TUTORIAL_WORLD
): TourStep[] {
  const chapter = TUTORIAL_CHAPTERS[chapterId];
  const ctx = coachCountryContext(character, world);
  const steps: TourStep[] = chapter.buildSteps(ctx).map((step) => ({
    ...step,
    chapterId,
    chapterTitle: chapter.title,
    chapterIndex: 0,
  }));
  if (steps.length === 0) return steps;
  steps.push({
    ...closingStep(1),
    chapterId,
    chapterTitle: chapter.title,
    chapterIndex: 0,
  });
  return steps;
}
