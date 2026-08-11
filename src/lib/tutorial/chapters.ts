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
 * Chapters are the single source of chapter copy: the welcome-flow cards, the
 * hub, and the coach's chapter rail all read the same titles and blurbs.
 */

export interface TutorialChapter {
  id: TutorialChapterId;
  title: string;
  icon: string;
  /** One line, shown on the selector card and the hub. */
  blurb: string;
  /** Rough reading/doing time, so the player can choose informed. */
  estimatedMinutes: number;
  /** Wiki learning path with the long version, if one covers this ground. */
  wikiPathSlug?: string;
  buildSteps: (ctx: CoachCountryContext) => CoachStep[];
}

/* ------------------------------------------------------------------ */
/* what's new — last for new players, first for returning ones         */
/* ------------------------------------------------------------------ */

/**
 * Curated highlights of the current iteration. Keep this to about five cards
 * and REWRITE IT each iteration; it does not derive from the changelog at run
 * time. Seeded from content/changelog/public/1.0.0.md.
 *
 * Runs for everyone, but placement differs (see chapterIdsForPlan): first for a
 * returning player, because it is the only reason they opened the tutorial, and
 * last for a new one, who needs the fundamentals before "what changed" means
 * anything.
 */
function whatsNewSteps(ctx: CoachCountryContext): CoachStep[] {
  return [
    {
      id: "whats-new-intro",
      title: "What changed this iteration",
      body: "These are the five changes most likely to catch out someone who played before. The full list is on the changelog page whenever you want it.",
      next: "Show me",
    },
    {
      id: "whats-new-founding",
      title: "Every country earns its starting position",
      body: "Worlds now open with a real founding election before anyone plays. No country is handed a result any more, so the seats and the governing party you arrive to were actually voted for.",
      next: "Next",
    },
    {
      id: "whats-new-unions",
      title: "Unions are a career you can take",
      body: "Every industry now has a union you can organise. Pay for a recruitment drive, run for union president, build up its treasury, and push wages up across the industry. Governments can ban unions by law, which freezes them until the ban is repealed.",
      readMore: { label: "See the unions", href: unionsUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "whats-new-households",
      title: "Ordinary people now buy things",
      body: "How much households spend follows their jobs, their wages, and prices. Give people work and rising pay and they spend more; let the cost of living climb and they stop. That spending goes to the companies selling to them, so where you build and who you employ now changes your own demand.",
      readMore: { label: "See the economy", href: economyUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "whats-new-ai",
      title: "The computer politicians got much smarter",
      body: "They now check the calendar instead of campaigning the same way three years out as the week before, they push harder when they are actually being challenged, and they stop paying for advertising once it has stopped working. They also have individual habits that drift over a career. There are firm limits on how much of this can land on you.",
      next: "Next",
    },
    {
      id: "whats-new-elections",
      title: "Elections are harder to coast through",
      body: "An incumbent's advantage now scales with how popular they actually are, parties that have held power a long time pick up a penalty, and every governor and senate race gets a real opponent. A census redraws the seats every ten years, so safe ground does not stay safe forever.",
      readMore: { label: "See the races", href: countryElectionsUrl(ctx.countryId) },
      next: "Got it",
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
      title: "Welcome to A House Divided",
      body: `${ctx.countryName} is a living country, and the other people in it are real players. The ones who do well build allies and an income early. A good platform on its own does not get you very far. This tour shows you the moves that actually matter. You can stop at any point and pick it up again from the tutorial page.`,
      facts: ["turn"],
      next: "Show me",
      fundamental: true,
    },
    {
      id: "how-turns-work",
      title: "The game moves in turns",
      body: "Nothing happens the moment you click it. What you do now resolves on the next turn, along with everyone else's moves and the economy. You get a small number of actions each turn. Money and influence carry over, but an unspent turn is gone.",
      facts: ["turn", "wallet"],
      next: "Next",
      fundamental: true,
    },
    {
      id: "join-discord",
      title: "Find other players first",
      body: "You will get much further with allies than on your own. The Discord is where players form parties, trade favours, agree how to vote, and explain the parts of the game nothing else explains. Join it now and come back.",
      link: COMMUNITY_DISCORD_URL,
      external: true,
      next: "Open Discord",
    },
    {
      id: "scout-region",
      title: `Look at your home ${ctx.region} before you spend anything`,
      body: `Everything starts local. Your ${ctx.region} page shows how its economy is doing, who currently holds office there, and which seats are coming up. Read it first so you know where the gaps are instead of guessing.`,
      hint: `Open your ${ctx.region} page to continue.`,
      anchor: "nav-region",
      link: regionUrl(ctx.countryId, ctx.homeState),
      facts: ["region", "regionEconomy"],
      next: "Next",
      waits: true,
    },
    {
      id: "read-wire",
      title: "Read the news every turn",
      body: "The News page tells you what other players did last turn and what the economy did in response. It is the difference between reacting to the game and being surprised by it. Most strong players read it before they spend anything.",
      hint: "Open the News page.",
      anchor: "nav-news",
      link: "/news",
      next: "Next",
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
      title: "How a career gets built here",
      body: "Nobody hands you an office. You join a party, spend actions to get your name known, win a small seat, build a voting record, and trade up from there. Players who try to start at the top almost always lose their first primary and give up.",
      facts: ["parties"],
      next: "Next",
      fundamental: true,
    },
    {
      id: "join-party",
      title: "Join a party first",
      body: "A party gives you a shared pool of actions to draw on, better odds in a primary, a lift from whoever is at the top of the ticket, and money from the party treasury when yours runs out. Running as an independent is much harder. Pick the party closest to your platform, or a weak one you think you can take over.",
      hint: "Open the parties page and join one.",
      anchor: "nav-parties",
      link: partiesUrl(ctx.countryId),
      facts: ["parties"],
      next: "Next",
      waits: true,
      advanceSignal: "party",
    },
    {
      id: "actions-what",
      title: "Actions are your time",
      body: "You get a few actions each turn and they are the main thing you have to spend. Money you can raise later. Actions you cannot get back. The next few cards walk through what each one does and when it is worth the cost.",
      hint: "Open the Actions page to follow along.",
      anchor: "nav-actions",
      link: "/actions",
      facts: ["wallet"],
      next: "Next",
      fundamental: true,
    },
    {
      id: "action-campaign",
      title: "Campaign is the one you start with",
      body: "Campaigning raises your Political Influence, which is how well known you are. It is the cheapest action in the game and it is what turns a nobody into someone who can win a primary. The cost goes up as your influence grows, so it is at its best right now while you have none.",
      hint: "Run a Campaign action to continue.",
      anchor: "action-campaign",
      link: "/actions",
      facts: ["wallet"],
      next: "Next",
      waits: true,
      advanceSignal: "campaign",
    },
    {
      id: "action-advertise",
      title: "Advertising is for later",
      body: "Adverts raise Favorability, which is whether people like you rather than whether they have heard of you. It costs about five times what campaigning costs. Buying adverts before anyone knows your name is the most common way new players waste a turn. Get your influence up first.",
      anchor: "action-advertise",
      link: "/actions",
      next: "Next",
    },
    {
      id: "action-fundraise",
      title: "Fundraising needs a donor base",
      body: "Fundraise turns your donor network into campaign money. If your donor level is zero it is greyed out, because you have nobody to call. That is why the next card matters more than this one on your first few turns.",
      anchor: "action-fundraise",
      link: "/actions",
      next: "Next",
    },
    {
      id: "action-donors",
      title: "Build the donor network early",
      body: "This is the action new players skip and regret. It costs a lot up front and pays nothing straight away, but every fundraise you ever run afterwards pays more. Do not fund your own campaign out of pocket instead. Self funding drives your Infamy up and bleeds Favorability every turn, and it is the fastest way to end a promising career.",
      anchor: "action-buildDonorBase",
      link: "/actions",
      next: "Got it",
    },
    {
      id: "file-for-race",
      title: "File for a race at home",
      body: `Your ${ctx.region} page lists the races you can actually enter. A ${ctx.region} legislature seat is the usual first run: it is cheap to contest, it is real power, and it gives you a voting record to campaign on next time. Win something small first, then climb.`,
      hint: `Open the Elections tab on your ${ctx.region} page and file for a race.`,
      anchor: "nav-races",
      link: regionElectionsUrl(ctx.countryId, ctx.homeState),
      facts: ["openSeats"],
      next: "Next",
      waits: true,
      advanceSignal: "candidacy",
    },
    {
      id: "first-vote",
      title: "Cast your first vote",
      body: `Once you hold a seat you can vote on bills in ${ctx.legislatureName}. Bills move real numbers like taxes, wages, and growth, and how you voted follows you into every race you run after this. If you do not hold a seat yet, skip ahead and come back when you win one.`,
      hint: `Open ${ctx.legislatureName} and read a bill on the floor.`,
      anchor: "nav-legislature",
      link: ctx.legislatureLink,
      next: "Next",
      waits: true,
      advanceSignal: "vote",
    },
    {
      id: "office-wider",
      title: "Where this goes next",
      body: "A seat is the start, not the finish. From here you chase committee places, party office, and leadership votes, and every one of those is decided by players you will need on your side. The Discord is where most of that gets arranged.",
      readMore: { label: "See every race", href: countryElectionsUrl(ctx.countryId) },
      next: "Got it",
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
      title: "Share prices here are not random",
      body: "A company is worth what it earns. What it earns depends on the sectors it works in, the wages it pays, and how much households can afford to buy. So the way to pick a share is to read the economy first and then buy the company that gains from what you just read.",
      next: "Next",
      fundamental: true,
    },
    {
      id: "invest-market",
      title: "Put your money somewhere",
      body: "You can buy shares in a single company, or buy into an index fund if you would rather hold a slice of everything and not pick. The market moves every turn whether or not you are paying attention, so leaving all your money in cash is also a decision, and usually a losing one.",
      hint: "Open the market and buy shares or fund units.",
      anchor: "nav-stockmarket",
      link: stockmarketUrl(ctx.countryId),
      facts: ["wallet"],
      next: "Next",
      waits: true,
      advanceSignal: "invest",
    },
    {
      id: "invest-portfolio",
      title: "Check what it actually paid you",
      body: "Your portfolio shows what you hold, what it is worth now, and what it has paid out. Dividends land each turn and report what really happened last turn rather than a smoothed average, so a bad sector looks bad straight away instead of a few turns later.",
      hint: "Open your portfolio.",
      anchor: "nav-portfolio",
      link: "/portfolio",
      next: "Next",
      waits: true,
    },
    {
      id: "invest-risk",
      title: "How people lose money here",
      body: "Usually one of three ways. They hold one company all the way through a downturn in its sector. They chase a high savings rate in a currency that is losing value faster than the interest pays. Or they borrow against something that then falls. Spread your holdings, watch inflation, and keep some cash back for campaigns.",
      next: "Got it",
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
      title: "A company here is a real business",
      body: "It is not just a share price. A company works in specific sectors, employs people in specific regions, buys what it needs from other companies, and sells to households and to the government. Run one well and it pays for a political career nobody can outspend.",
      next: "Next",
      fundamental: true,
    },
    {
      id: "company-take-charge",
      title: "Start one, or take over an empty chair",
      body: "You can found a company from nothing, or step into one whose chief executive seat is empty. Taking over is usually faster: the buildings, the staff and the contracts already exist and you get them on day one. Both start from the market page.",
      hint: "Open the market page and found or claim a company.",
      anchor: "nav-corporations",
      link: stockmarketUrl(ctx.countryId),
      facts: ["companies"],
      next: "Next",
      waits: true,
      advanceSignal: "company",
    },
    {
      id: "company-sectors",
      title: "Sectors are where the money comes from",
      body: "Every company works in one or more sectors, and each has its own demand, its own input costs, and a limit on how much it can produce. Adding capacity costs money and takes several turns to come online. So pick the sector the economy is about to need, not the one that did well last year.",
      next: "Next",
      fundamental: true,
    },
    {
      id: "company-labour",
      title: "Wages cut both ways",
      body: "Pay too little and output drops, workers organise, and you get strikes. Pay too much and you have no margin left. There is a second effect that catches people out: the people you employ are also the people who buy things. Squeeze wages across your own region and you shrink the market you are selling into.",
      readMore: { label: "See the economy", href: economyUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "company-shares",
      title: "Raising money without losing control",
      body: "Selling shares raises money quickly, but every share you sell is a vote you no longer hold, and someone can buy enough of them to remove you. Founders keep control through their founding stake and through supershares. Work out how much of the company you are willing to give up before you list it, not after.",
      next: "Got it",
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
      title: "A union is pressure, not a member list",
      body: "Unions here are not groups of players. Each one has a membership pressure score that stands for the workers in that industry. Pressure is what gives a union any power at all, and organising drives are how it goes up. As leader, your job is to raise it and then spend it on something worth having.",
      next: "Next",
      fundamental: true,
    },
    {
      id: "union-find",
      title: "Find your industry",
      body: "Every industry has a union. Some already have a leader and some are sitting empty. An empty union in an industry that employs a lot of people is probably the best opening in the game for a new player with no money and no reputation, because nobody is competing with you for it.",
      hint: "Open the unions page and back one.",
      anchor: "nav-unions",
      link: unionsUrl(ctx.countryId),
      facts: ["unions"],
      next: "Next",
      waits: true,
      advanceSignal: "union",
    },
    {
      id: "union-organize",
      title: "Pay for a drive to get a vote",
      body: "Spending your own money on an organising drive raises that union's membership pressure and earns you a vote in its leadership election. That is the whole ladder: organise, get a vote, win the leadership, then you control the treasury.",
      readMore: { label: "Back a union", href: unionsUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "union-power",
      title: "Wage demands and strikes",
      body: "A union with enough pressure and money behind it can demand higher wages across its industry, and strike if employers refuse. Strikes cost the union money and cost companies output, so it is a threat you spend rather than a button you press repeatedly. Watch out for governments passing a ban, which freezes your union until it is repealed.",
      next: "Got it",
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
      title: "This is the top of the ladder",
      body: `Running ${ctx.countryName} is not where you start. The route is a party, then a local seat, then a national seat, then the executive. This chapter shows you what is waiting at the top so you know what you are climbing towards and which jobs are worth taking on the way.`,
      next: "Show me",
      fundamental: true,
    },
    {
      id: "nation-executive",
      title: "How the top job gets won",
      body: `The executive page shows who holds power in ${ctx.countryName} right now, how they got it, and when the job is next contested. Read how your country picks its leader before you plan a run, because the rules are genuinely different from country to country.`,
      readMore: { label: "See who holds power", href: executiveUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "nation-cabinet",
      title: "Cabinet posts are the realistic first step",
      body: "Cabinet jobs run a whole area of policy and they are handed out rather than elected. For most players that is the first real taste of national power, long before the top job is possible. Which means being useful to whoever will be doing the handing out is worth more than any campaign action.",
      readMore: { label: "See the cabinet", href: cabinetUrl(ctx.countryId) },
      next: "Next",
    },
    {
      id: "nation-budget",
      title: "Governing is mostly arithmetic",
      body: "The budget is where promises meet money. Every programme costs something, every tax slows something down, and deficits turn into debt payments that squeeze out everything you actually wanted to do. Read it before you promise anything in a campaign.",
      hint: "Open the national budget.",
      anchor: "nav-budget",
      link: budgetUrl(ctx.countryId),
      next: "Next",
      waits: true,
    },
    {
      id: "nation-money",
      title: "The levers underneath the budget",
      body: "The central bank sets interest rates, and those move inflation, the cost of borrowing, and the value of your currency. A leader who ignores this still gets the consequences. Currency strength also sets what imports cost you and what your exporters earn abroad.",
      readMore: { label: "See the central bank", href: centralBankUrl(ctx.countryId) },
      next: "Got it",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

export const TUTORIAL_CHAPTERS: Record<TutorialChapterId, TutorialChapter> = {
  "whats-new": {
    id: "whats-new",
    title: "What changed",
    icon: "🆕",
    blurb: "The five changes most likely to catch out someone who played last iteration.",
    estimatedMinutes: 3,
    buildSteps: whatsNewSteps,
  },
  core: {
    id: "core",
    title: "Getting started",
    icon: "🧭",
    blurb: "Turns, your home region, the wire, and where the other players are.",
    estimatedMinutes: 4,
    wikiPathSlug: "new-player",
    buildSteps: coreSteps,
  },
  office: {
    id: "office",
    title: "Run for office",
    icon: "🗳️",
    blurb: "Join a party, campaign, win a seat, and vote on real laws.",
    estimatedMinutes: 7,
    wikiPathSlug: "running-for-office",
    buildSteps: officeSteps,
  },
  invest: {
    id: "invest",
    title: "Invest",
    icon: "💰",
    blurb: "Buy shares and funds, collect dividends, and avoid the usual traps.",
    estimatedMinutes: 4,
    buildSteps: investSteps,
  },
  company: {
    id: "company",
    title: "Run a company",
    icon: "🏢",
    blurb: "Found or take over a corporation. Pick sectors, set wages, raise capital.",
    estimatedMinutes: 6,
    buildSteps: companySteps,
  },
  union: {
    id: "union",
    title: "Run a union",
    icon: "✊",
    blurb: "Organize an industry, win the leadership, and push wages up.",
    estimatedMinutes: 5,
    buildSteps: unionSteps,
  },
  nation: {
    id: "nation",
    title: "Run a nation",
    icon: "🏛️",
    blurb: "The top of the ladder: the executive, the cabinet, the budget, the bank.",
    estimatedMinutes: 6,
    wikiPathSlug: "advanced-strategy",
    buildSteps: nationSteps,
  },
};

/** The five interest chapters, in the order the welcome-flow selector shows them. */
export const INTEREST_CHAPTERS: TutorialChapter[] = (
  ["invest", "company", "union", "office", "nation"] satisfies TutorialInterest[]
).map((id) => TUTORIAL_CHAPTERS[id]);

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
  plan: TutorialPlan
): ResolvedChapter[] {
  const ctx = coachCountryContext(character);
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
    title: "That is the loop",
    body:
      chapterCount > 2
        ? "Read the wire, spend your actions where they count, and let the turns compound. You can replay any chapter from the tutorial page whenever you want it. Good luck out there."
        : "That is your path. If you want to see one of the others later, the tutorial page has every chapter and you can run them one at a time. Good luck out there.",
    next: "Done",
  };
}

/**
 * The player's whole tour as one flat step list, each step tagged with the
 * chapter it came from so the coach can draw its rail and jump between
 * chapters. Empty for a plan whose experience is "skip".
 */
export function buildTourSteps(character: CoachCharacter, plan: TutorialPlan): TourStep[] {
  const chapters = buildTourChapters(character, plan);
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
  chapterId: TutorialChapterId
): TourStep[] {
  const chapter = TUTORIAL_CHAPTERS[chapterId];
  const ctx = coachCountryContext(character);
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
