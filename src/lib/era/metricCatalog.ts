import type { CountryId } from "@/lib/constants/countries";
import { metricCategories, type MetricDefinition } from "@/lib/constants/metricDefinitions";

/**
 * Metric Era Catalog — the single source of truth for how a metric behaves
 * across eras and countries. Owns three declarative tables (existence windows,
 * band curves, era display names) plus era envelopes, with pure resolvers.
 *
 * Everything here is inert while `eraSystemEnabled` is off: every resolver
 * treats a null year as "legacy" (all metrics active, no era bands, no
 * envelopes), so flag-off behavior is byte-identical.
 *
 * Spec: docs/superpowers/specs/2026-07-04-metric-era-catalog-design.md
 */

export interface EraNews {
  title: string;
  body: string;
}

export interface MetricEraWindow {
  /** Calendar year the metric starts existing. Absent from table = exists always. */
  from: number;
  /**
   * When set, the window gates ONLY these countries; all others are always
   * active. Needed because several "country-flavored" metrics are
   * uniform-seeded with meaningful values in all 8 countries (e.g.
   * devolutionSatisfaction reads as DE Föderalismus) — a global `from` would
   * wrongly hide them elsewhere.
   */
  countries?: CountryId[];
  /**
   * Per-country activation-year overrides (e.g. NG broadband later). Each
   * override is its own activation event and carries its OWN news copy —
   * reusing the base copy would post the identical "invention" twice, and an
   * override EARLIER than the base (foreignWorkerIntegration DE) would fire
   * the generic copy for one country decades before the universal activation.
   */
  countryOverrides?: Partial<Record<CountryId, { from: number; news: EraNews }>>;
  /** Flavored activation news for the base `from` activation. No literal years. */
  news: EraNews;
}

export interface BandAnchor {
  year: number;
  best: number;
  worst: number;
}

export const METRIC_ERA_WINDOWS: Record<string, MetricEraWindow> = {
  // ── Universal windows ───────────────────────────────────────────────────────
  broadbandAccess: {
    from: 1998,
    countryOverrides: {
      NG: {
        from: 2008,
        news: {
          title: "Broadband Reaches Nigeria",
          body: "Lagos woke to a new kind of arrival: not a ship heavy with goods, but cables laid beneath the sea, carrying the promise of faster connections and wider horizons. Engineers, business owners, journalists, and students gathered around the news with unusual excitement, speaking of a Nigeria where the high-speed web would no longer be reserved for a thin slice of offices and elite institutions.\n\nThe first effects are uneven, but unmistakable. Internet cafés fill with young entrepreneurs, banks begin planning deeper digital services, and city firms look outward with fresh confidence. In the ministries, a new question is being asked: how quickly can the country turn connection into opportunity? Broadband access has entered Nigeria's national scoreboard.",
        },
      },
    },
    news: {
      title: "The World Logs On",
      body: "Across the industrialized world, telephone poles, cable ducts, and apartment basements have become the new front line of modernization. Commercial providers are racing to wire ordinary homes for always-on, high-speed internet, promising that the web will no longer be something citizens “visit,” but something that hums quietly in the background of daily life.\n\nThe change is already unsettling older assumptions. Small businesses can advertise beyond their own streets, students can reach libraries without entering them, and ministries are beginning to wonder whether a population that can communicate instantly will remain patient with paper forms and office queues. Broadband access has become more than a technical convenience; it is now a measure of whether a country is truly plugged into the new century.",
    },
  },
  socialMediaSentiment: {
    from: 2004,
    news: {
      title: "Everyone's Talking",
      body: "The web has stopped behaving like a quiet library. New social platforms are turning it into a crowded public square, where jokes, rumors, praise, anger, and political argument travel farther and faster than any editor or minister can easily control. Citizens who once wrote letters to newspapers now broadcast their moods to entire networks before breakfast.\n\nGovernments are discovering that public opinion is no longer measured only at the ballot box or in carefully timed surveys. A policy announcement can gather applause by noon and outrage by evening. Social media sentiment is becoming a living gauge of national trust, impatience, and agitation — volatile, noisy, and impossible to ignore.",
    },
  },
  renewableEnergy: {
    from: 1974,
    news: {
      title: "Power Beyond the Barrel",
      body: "The oil shock has reminded capitals from London to Tokyo that fuel is never just fuel. When tankers slow and prices leap, factories shudder, households grumble, and ministers discover that energy dependence can become a diplomatic leash. In response, governments are opening grant offices, research programs, and pilot fields for wind, solar, geothermal, and anything else that might loosen the barrel's grip.\n\nAt first, the new machines look fragile beside coal plants and oil terminals. But their political importance is growing faster than their output. Renewable energy has become a promise of independence, resilience, and technological prestige. What was once treated as an engineer's curiosity is now a national metric watched by planners and voters alike.",
    },
  },
  energyTransitionProgress: {
    from: 2000,
    news: {
      title: "The Great Rewiring",
      body: "Energy ministries have begun publishing roadmaps with a new confidence and a new anxiety. The old question — how much power can the grid produce? — is being joined by a harder one: how quickly can the grid change what it is made of? Coal stations, gas turbines, nuclear plants, wind farms, solar arrays, and transmission lines are now pieces in a public race.\n\nThe language of transition has moved out of specialist reports and into speeches, budgets, and election manifestos. Every country claims to be preparing for the future, but the numbers will decide who is moving and who is merely announcing. Energy transition progress is now a scoreboard for ambition, competence, and political will.",
    },
  },
  carbonEmissions: {
    from: 1990,
    news: {
      title: "The Climate Enters Politics",
      body: "A new kind of accounting is spreading through the world's capitals. Scientists, diplomats, and civil servants are no longer speaking of smoke, soot, and pollution alone; they are counting carbon, comparing economies, and warning that the atmosphere itself has become a ledger. What once seemed like a distant scientific concern has entered cabinet rooms and campaign speeches.\n\nThe consequences are awkward for every government. Growth, industry, transport, agriculture, and energy can now be measured against what they release into the sky. Carbon emissions have become a political number: cited by reformers, challenged by industry, negotiated by diplomats, and watched by citizens who sense that the weather is no longer just weather.",
    },
  },
  recyclingRate: {
    from: 1972,
    news: {
      title: "Waste Not",
      body: "The humble bin has acquired a civic mission. Across cities and towns, municipal leaders are experimenting with separated paper, glass, cans, and household waste, urging residents to see yesterday's rubbish as tomorrow's resource. What began as a patchwork of local experiments is becoming a visible sign of modern administration.\n\nThe new habit is not universally loved. Some citizens grumble about extra containers and collection rules, while reformers insist that a throwaway society cannot endure forever. Recycling rate has entered public life as a small but telling measure: how much waste can a country rescue from the landfill, and how willing are its people to participate?",
    },
  },
  climateResilience: {
    from: 2000,
    news: {
      title: "Preparing for a Rougher Sky",
      body: "Floodwalls, firebreaks, cooling centers, drainage tunnels, drought plans, and emergency shelters have begun appearing in budget documents with unusual urgency. The weather has always tested governments, but officials are increasingly planning for a climate that seems less predictable, less forgiving, and more expensive to ignore.\n\nThe politics of preparation are uncomfortable. It is easier to cut a ribbon on a new bridge than to defend spending on disasters that have not happened yet. Still, insurers, mayors, farmers, and emergency planners are pressing the point. Climate resilience is now a public measure of whether a state can protect its people before the storm arrives.",
    },
  },
  nuclearSafety: {
    from: 1957,
    countryOverrides: {
      JP: {
        from: 1966,
        news: {
          title: "Japan Enters the Atomic Age",
          body: "At Tōkai, Japan has stepped into the atomic age of electricity. For a nation hungry for power and technological standing, the reactor is more than a machine; it is a statement that Japan intends to master the industries of the future. Officials in Tokyo speak of energy security, engineering skill, and a modern grid fit for a rising economy.\n\nYet the achievement arrives with solemn questions. In fishing towns, factory districts, and university halls, citizens ask how safety will be proven and who will be trusted to prove it. Nuclear safety has entered Japan's national conversation as both a technical standard and a test of public confidence.",
        },
      },
    },
    news: {
      title: "The Atom Goes to Work",
      body: "The atom has left the laboratory and entered the power station. Commercial nuclear plants are beginning to feed electricity into national grids, carrying with them a promise of extraordinary power and an unease that no minister can quite dismiss. Engineers speak of precision and control; citizens speak more quietly of risk.\n\nAs reactors become symbols of progress, their safety becomes a public matter. Inspection regimes, emergency plans, plant design, operator training, and official honesty are now part of the same national calculation. Nuclear safety has become the number behind the promise: whether the atom serves the people, or frightens them.",
    },
  },
  roboticsAdoption: {
    from: 1980,
    news: {
      title: "The Robots Clock In",
      body: "The factory floor is changing shape. Industrial robots, once displayed as marvels at trade fairs, are now taking their places beside human workers in welding bays, assembly lines, and precision workshops. They do not tire, strike, or blink, and managers are beginning to imagine production schedules built around mechanical patience.\n\nThe public mood is mixed. Business papers praise productivity and export strength, while labor halls warn that the new metal workers may not simply assist the old ones. Robotics adoption has become an economic measure with a social shadow: how fast industry can automate, and how well society can absorb what follows.",
    },
  },
  demographicDecline: {
    from: 1990,
    news: {
      title: "The Birth Dearth",
      body: "The statisticians have brought grim charts to the cabinet table. Birthrates are falling, families are shrinking, and the age pyramid that once looked sturdy now seems to lean toward the elderly. What was once discussed as a private matter of households is becoming a public concern of budgets, pensions, schools, housing, and national confidence.\n\nPoliticians find the issue difficult to command. A government can build roads and raise taxes, but it cannot simply order citizens to have children. Demographic decline has become a slow-moving national worry, one that shows up first in classrooms, then in hospitals, then in the treasury's long-term forecasts.",
    },
  },
  foreignWorkerIntegration: {
    from: 1990,
    countryOverrides: {
      DE: {
        from: 1961,
        news: {
          title: "Gastarbeiter Wanted",
          body: "Bonn has opened the door wider to workers from the Mediterranean, signing recruitment agreements meant to keep the engines of the Wirtschaftswunder turning. Trains arrive carrying men and women with suitcases, contracts, and hopes, bound for factories, mines, workshops, and crowded boarding houses across West Germany.\n\nOfficials call them guest workers, but life is already proving more complicated than the phrase suggests. A guest may stay, a workplace may become a neighborhood, and a temporary solution may become part of the country's future. How Germany receives, houses, employs, and includes these workers has become a question of its own.",
        },
      },
    },
    news: {
      title: "Workers Without Borders",
      body: "Airports, ports, farms, hospitals, factories, and construction sites are telling the same story: labor no longer stops neatly at the border. Workers are arriving to fill gaps, chase wages, support families abroad, and build lives in countries still deciding what kind of welcome they mean to offer.\n\nThe practical questions come quickly. Can newcomers find housing, language support, legal protection, and fair work? Can host communities absorb change without resentment? Foreign worker integration has become a measure governments can no longer avoid, sitting at the intersection of labor policy, social trust, and national identity.",
    },
  },
  mentalHealthAccess: {
    from: 1970,
    news: {
      title: "Out of the Asylum",
      body: "The old walls are beginning to lose their authority. Across health ministries and hospital boards, reformers are arguing that mental health care should not be hidden away in remote institutions, but brought closer to families, clinics, and communities. The locked ward is no longer treated as the natural center of treatment.\n\nThe change is humane, but difficult. Community care requires funding, trained staff, housing, emergency support, and a public willing to see mental illness as part of health rather than shame. Mental health access has become a public-health yardstick: not merely whether a country confines suffering, but whether it treats it.",
    },
  },

  // ── Country-scoped windows (gate ONLY the listed countries) ────────────────
  devolutionSatisfaction: {
    from: 1999,
    countries: ["UK"],
    news: {
      title: "Power Devolved",
      body: "Power has moved north and west from Westminster. A Scottish Parliament and a Welsh Senedd now stand as more than symbols, carrying real authority and raising expectations that decisions can be made closer to the people they affect. The old union has not ended, but it has been rearranged.\n\nWith new chambers come new arguments. Citizens will ask whether devolution brings dignity, efficiency, fairness, or simply another layer of politics. Devolution satisfaction has become a measure of whether the nations feel heard inside the United Kingdom, or merely managed from a shorter distance.",
    },
  },
  antiSocialBehaviourRate: {
    from: 1998,
    countries: ["UK"],
    news: {
      title: "Britain Names a Nuisance",
      body: "Britain has given a legal name to the everyday aggravations that fill local papers and council surgeries: harassment in stairwells, vandalism at bus stops, drunken noise, intimidation on estates, and the low-level disorder that makes public life feel smaller. The phrase “anti-social behaviour” has entered the national vocabulary with unusual speed.\n\nSupporters say the law finally gives communities a tool against conduct too persistent to ignore and too slippery for traditional policing. Critics warn that a broad label can become a blunt instrument. Either way, Britain has a new statistic to argue about, and anti-social behaviour is now counted as part of the condition of the country.",
    },
  },

  // ── Country-specific windows ────────────────────────────────────────────────
  schuldenbremseHeadroom: {
    from: 2009,
    news: {
      title: "Germany Chains the Budget",
      body: "Berlin has fastened a new restraint onto the federal purse. The debt brake, written into the Grundgesetz, turns fiscal discipline from a political promise into a constitutional command. Budgets that once lived mainly in party negotiations now face a harder ceiling and a more unforgiving arithmetic.\n\nThe rule will be praised as prudence and condemned as a cage, often in the same week. Finance ministers must now defend not only what they spend, but how closely they stand beneath the constitutional limit. Schuldenbremse headroom has become a measure of Germany's room to maneuver — and of how tightly the future has been tied to the balance sheet.",
    },
  },
  eastWestConvergence: {
    from: 1990,
    news: {
      title: "One Germany, Two Economies",
      body: "The border has opened, the flags have joined, and Germany is one country again. But the ledgers tell a harder story. East and West enter unity with different wages, industries, infrastructure, savings, expectations, and scars. The political miracle is immediate; the economic repair will not be.\n\nEvery renovated station, shuttered factory, new road, and departing young worker becomes part of a national reckoning. Closing the gap between East and West is now more than a development project. East-West convergence has become Germany's defining domestic test: whether unity can be made real in pay packets, towns, and futures.",
    },
  },
  euCohesionScore: {
    from: 1993,
    news: {
      title: "The Union Takes Shape",
      body: "Europe has changed its name and deepened its ambition. Maastricht has turned a common market into a European Union, binding member states not only through trade, but through institutions, rules, expectations, and a widening sense of shared destiny. For Germany, the question is not whether Europe matters, but how closely Berlin will move with it.\n\nThe new union brings opportunity and constraint in equal measure. German governments will be judged by their ability to lead without dominating, compromise without drifting, and align national policy with European purpose. EU cohesion has become a running score of Germany's place inside the continent it helped rebuild.",
    },
  },
  rentenStabilitaet: {
    from: 1957,
    news: {
      title: "The Dynamic Pension",
      body: "Germany has made a sweeping promise to its retirees: pensions will move with wages, allowing old age to share in the prosperity of working life. The reform is being celebrated as a pillar of social security, a sign that the postwar state can offer not only reconstruction, but dignity.\n\nThe promise is powerful because it is visible. Workers can imagine retirement with fewer fears, while governments inherit a duty that grows with expectations and demographics. Renten-Stabilität has become a public measure of whether Germany can keep faith with those who built the republic's recovery.",
    },
  },
  bundeswehrReadiness: {
    from: 1956,
    news: {
      title: "Germany Rearms",
      body: "A democratic Germany has fielded an army again. The Bundeswehr is founded under careful eyes at home and abroad, carrying the burden of history into every barracks, uniform, and oath. Its purpose is defense, its legitimacy tied to civilian control, and its existence debated with a seriousness few institutions must endure.\n\nReadiness is no longer a purely military matter. It is a question of trust, alliance obligations, equipment, training, and whether a republic determined never to repeat the past can still defend its present. Bundeswehr readiness has entered public record as both a strategic metric and a moral test.",
    },
  },
  kitaCoverage: {
    from: 1996,
    news: {
      title: "A Place for Every Child",
      body: "Germany has written a promise into law: young children should have a claim to a Kita place. For parents balancing work, family, and long waiting lists, the reform is not abstract. It reaches into kitchens, offices, factory shifts, and the morning scramble of everyday life.\n\nThe challenge now moves from principle to provision. Municipalities must find buildings, staff, budgets, and patience, while families measure the promise against the places actually available. Kita coverage has become a number parents can hold the state to, and a quiet test of whether family policy exists beyond speeches.",
    },
  },
  slaintecareProgress: {
    from: 2017,
    news: {
      title: "Ireland Draws the Map to Universal Care",
      body: "The Dáil has embraced a new roadmap for Irish health care, promising a future where access depends less on income, insurance, or luck. Sláintecare speaks in the language of a single-tier system, shorter waits, stronger primary care, and a service designed around patients rather than payment categories.\n\nThe ambition is large enough to inspire and specific enough to be measured. Every clinic opened, list shortened, reform delayed, or budget contested will now be judged against the map. Sláintecare progress has become a national tracker for whether Ireland can turn a long-discussed ideal into a working health service.",
    },
  },
  gniStarGap: {
    from: 2017,
    news: {
      title: "Leprechaun Economics Gets a Ruler",
      body: "Ireland's headline growth figures have become too strange to trust at first glance. Multinational accounting, intellectual property movements, and corporate structures can make the national economy appear to leap like a fairy-tale creature. In response, statisticians have introduced a cleaner measure meant to see past the magic trick.\n\nThe new yardstick does not end the argument, but it gives it firmer ground. Ministers, economists, and voters can now compare the shining headline with the economy Irish households actually live in. The GNI-star gap has become a number in its own right: a measure of how much reality hides beneath spectacular GDP.",
    },
  },
  directProvisionLoad: {
    from: 2000,
    news: {
      title: "Ireland Opens Direct Provision",
      body: "Ireland has created a dedicated system to house asylum seekers while their claims are processed. Direct Provision begins as an administrative answer to a practical question, but the centers quickly become more than facilities on a government chart. They become places where policy is lived, waited through, and judged.\n\nThe state now faces a delicate measure of welcome and capacity. How crowded are the centers? How long do people remain in limbo? How fairly can a small country manage protection, process, and public concern? Direct Provision load has become a visible gauge of pressure on Ireland's asylum system.",
    },
  },
  hseWaitingListMonths: {
    from: 2005,
    news: {
      title: "One Health Service for Ireland",
      body: "Ireland's regional health boards have been folded into a single national executive, creating one organization to carry the weight of hospitals, community care, staffing, budgets, and reform. The promise is coordination: fewer silos, clearer responsibility, and a health service that can be managed as one national system.\n\nBut the public will measure the reform in months, not memos. Waiting lists become the country's most-watched queue, discussed at kitchen tables and raised in the Dáil with painful regularity. HSE waiting list months now stand as a hard measure of whether administrative unity can produce care on time.",
    },
  },
  capDependency: {
    from: 1973,
    news: {
      title: "Ireland Joins the Common Market",
      body: "Ireland has stepped into the European common market, and rural Ireland is already looking toward Brussels with cautious hope. For farmers, membership brings new supports, rules, prices, and possibilities. The farm gate is no longer connected only to Dublin and the local mart, but to a continental system of agricultural policy.\n\nThe money will matter. So will the dependency it creates. As subsidies become woven into farm income, rural politics gains a new calculation: how much of Ireland's agricultural life rests on European support? CAP dependency has become a fact of the countryside, counted in budgets, livelihoods, and political loyalty.",
    },
  },
  mncDependency: {
    from: 1960,
    news: {
      title: "Ireland Courts the Multinationals",
      body: "Ireland has begun courting foreign industry with tax relief, new facilities, and the bold experiment of a free zone at Shannon. Officials speak of jobs, exports, and escape from the narrow limits of an economy too long defined by emigration and underdevelopment. The invitation is clear: bring your factories, your offices, your capital, and your future plans.\n\nSuccess will bring its own vulnerability. As multinationals arrive, the exchequer, the labor market, and entire towns may come to depend on decisions made in boardrooms far from Dublin. MNC dependency has become a number to watch: a measure of how much national prosperity rides on companies that can always choose another shore.",
    },
  },
  fdiPipelineStrength: {
    from: 1960,
    news: {
      title: "Selling Ireland to the World",
      body: "Ireland's development officials have gone abroad with brochures, promises, and a sharpened sense of mission. They are selling the country not as a place people must leave, but as a place companies should enter. Industrial estates, tax incentives, and a young workforce are being assembled into a national pitch.\n\nThe pipeline of foreign direct investment soon becomes a scoreboard of confidence. Each promised factory, office, and payroll is celebrated as proof that the strategy is working. But a pipeline can narrow as well as widen. FDI pipeline strength now measures Ireland's ability to keep the attention of a restless global economy.",
    },
  },
  agriEmissionsShare: {
    from: 1990,
    news: {
      title: "Ireland Counts the Herd",
      body: "Climate accounting has reached the farm gate. Ireland's pastures, cattle, dairy herds, and rural exports are now being counted not only in jobs and produce, but in emissions. The fields that helped define the nation's image have become part of a new environmental ledger.\n\nThis is not an easy number for Irish politics. Agriculture is livelihood, culture, export strength, and family inheritance, yet it is also a major part of the country's climate challenge. Agri-emissions share has become a political measure with mud on its boots, forcing Dublin to weigh green ambition against rural reality.",
    },
  },
  socialCreditCoverage: {
    from: 2014,
    news: {
      title: "Beijing Keeps Score",
      body: "Beijing has begun piloting a social-credit framework that links conduct, compliance, reputation, and consequence into a system of state measurement. Officials describe it as a tool for trust, order, and accountability in a vast society where markets, migration, and digital life have moved faster than older forms of supervision.\n\nThe reach of the system is now the story. Local pilots, databases, blacklists, rewards, penalties, and administrative experiments are being watched as signs of how deeply the state can score behavior. Social credit coverage has become a measure not only of policy rollout, but of the government's capacity to make society legible.",
    },
  },
  beltAndRoadEngagement: {
    from: 2013,
    news: {
      title: "A New Silk Road",
      body: "Beijing has unveiled a grand outward vision: ports, railways, highways, pipelines, loans, and trade corridors stretching across continents under the banner of a new Silk Road. The language is ancient, but the tools are modern — finance, construction, diplomacy, and infrastructure offered at a scale few states can match.\n\nFor China, the initiative is both economic map and geopolitical signal. Each overseas project becomes a marker of reach, each partner a thread in a wider network. Belt and Road engagement has become a gauge of how far Chinese ambition travels beyond its borders, and how tightly the world's roads may bend toward Beijing.",
    },
  },
  commonProsperityIndex: {
    from: 2021,
    news: {
      title: "Prosperity for All, by Decree",
      body: "Beijing has elevated common prosperity from slogan to doctrine. The campaign promises to narrow the gap between coast and interior, rich and poor, platform giants and ordinary workers, urban privilege and rural patience. It is a call for growth to justify itself not only by speed, but by distribution.\n\nThe order carries both moral language and administrative weight. Companies adjust their tone, local officials study new targets, and citizens listen for whether the promise will reach wages, housing, education, and opportunity. The common prosperity index has become a campaign with a score: a measure of whether China's rise can be made to feel shared.",
    },
  },
  eastWestRegionalGap: {
    from: 1980,
    news: {
      title: "China's Coast Pulls Ahead",
      body: "The seaboard has caught fire with ambition. Special economic zones, foreign capital, export factories, and restless local officials are transforming coastal China into a workshop of astonishing speed. Cities that once looked outward with caution now face the world with cranes, docks, and neon.\n\nBut the interior is watching. As coastal provinces surge ahead, inland communities measure the distance in wages, roads, schools, and chances for their children. The east-west regional gap has become China's internal frontier: a test of whether reform can lift the whole country, or merely pull the coast beyond reach.",
    },
  },
  hukouMobility: {
    from: 1958,
    news: {
      title: "The Hukou Takes Hold",
      body: "China's household-registration system has begun binding families to their place on the official registry. Where a person belongs is no longer only a matter of home, memory, or village ties; it is an administrative fact shaping access to grain, schooling, work, housing, and permission to move.\n\nThe system gives the state a powerful lever over population and development. It can steady cities, organize labor, and preserve control, but it can also trap ambition behind paperwork. Hukou mobility has become a measure of how freely people may move through the country their labor is helping to build.",
    },
  },
};

/**
 * Whether a metric exists ("is active") for a country at a live year.
 * year null (flag off / legacy) → always true. Window absent → true.
 * `countries`-scoped windows gate only the listed countries.
 */
export function isMetricActive(
  metricId: string,
  countryId: string | undefined,
  year: number | null
): boolean {
  if (year == null || !Number.isFinite(year)) return true;
  const w = METRIC_ERA_WINDOWS[metricId];
  if (!w) return true;
  if (w.countries && (!countryId || !w.countries.includes(countryId as CountryId))) return true;
  const override = countryId ? w.countryOverrides?.[countryId as CountryId] : undefined;
  return year >= (override?.from ?? w.from);
}

/**
 * Direction lookup derived from metricDefinitions (the SSOT). Deliberately NOT
 * imported from metricScoring — that module imports this one (cycle).
 */
const IS_HIGHER_BETTER_LOCAL: Record<string, boolean> = Object.fromEntries(
  metricCategories.flatMap((c) => c.metrics.map((m) => [m.id, m.isHigherBetter]))
);

export interface MetricBandCurve {
  /** Fallback anchors when a country has none. Optional — static THRESHOLDS is the final fallback. */
  global?: BandAnchor[];
  /** Per-country anchors; first-class, not an outlier patch. */
  byCountry?: Partial<Record<CountryId, BandAnchor[]>>;
}

/**
 * Absolute {year, best, worst} band curves — no reference year; 2019 is just
 * another anchor. Tasks 11-12 author the full dataset.
 * INVARIANT (validated): every key here exists in metricScoring.THRESHOLDS —
 * a curve must never silently make an unscored metric scored.
 */
/**
 * Core-5 curves are authored as per-country ERA NORMALS (the unremarkable value
 * for that country in that year) and converted to absolute best/worst anchors
 * by each metric's fixed band spread — the same geometry as its static
 * THRESHOLDS band (hardcoded here, NOT imported from metricScoring: cycle).
 * Floors keep bands inside each metric's playable range. The global set is the
 * old PR #2661 Western curve (US-shaped), kept as the fallback for latent
 * countries (RU, …). Values are era-plausible authored estimates — the dry-run
 * review is the tuning gate before any flag flip.
 */
type NormalAnchor = { year: number; value: number };
const CORE5_SPREADS: Record<
  string,
  { best: number; worst: number; bestFloor?: number; worstCeil?: number }
> = {
  gdpGrowth: { best: 2.8, worst: -5.2 },
  unemploymentRate: { best: -2, worst: 11, bestFloor: 0.5, worstCeil: 25 },
  lifeExpectancy: { best: 6, worst: -9 },
  violentCrimeRate: { best: -300, worst: 320, bestFloor: 20 },
  povertyRate: { best: -7, worst: 14, bestFloor: 3, worstCeil: 45 },
};

const CORE5_NORMALS: Record<string, Partial<Record<CountryId | "global", NormalAnchor[]>>> = {
  gdpGrowth: {
    global: [
      { year: 1950, value: 4.2 },
      { year: 1970, value: 3.6 },
      { year: 1990, value: 2.9 },
      { year: 2019, value: 2.2 },
      { year: 2040, value: 1.8 },
    ],
    US: [
      { year: 1953, value: 4.2 },
      { year: 1979, value: 3.4 },
      { year: 1991, value: 2.9 },
      { year: 2019, value: 2.2 },
      { year: 2040, value: 1.8 },
    ],
    UK: [
      { year: 1953, value: 3.0 },
      { year: 1979, value: 2.4 },
      { year: 1991, value: 2.2 },
      { year: 2019, value: 1.5 },
      { year: 2040, value: 1.3 },
    ],
    DE: [
      { year: 1953, value: 7.5 },
      { year: 1979, value: 3.0 },
      { year: 1991, value: 3.5 },
      { year: 2019, value: 1.2 },
      { year: 2040, value: 1.0 },
    ],
    JP: [
      { year: 1953, value: 8.0 },
      { year: 1979, value: 5.0 },
      { year: 1991, value: 3.5 },
      { year: 2019, value: 0.8 },
      { year: 2040, value: 0.8 },
    ],
    IE: [
      { year: 1953, value: 2.0 },
      { year: 1979, value: 3.5 },
      { year: 1991, value: 3.5 },
      { year: 2019, value: 5.0 },
      { year: 2040, value: 2.5 },
    ],
    BR: [
      { year: 1953, value: 6.5 },
      { year: 1979, value: 6.5 },
      { year: 1991, value: 1.5 },
      { year: 2019, value: 1.5 },
      { year: 2040, value: 2.0 },
    ],
    CN: [
      { year: 1953, value: 6.0 },
      { year: 1979, value: 6.5 },
      { year: 1991, value: 9.0 },
      { year: 2019, value: 6.0 },
      { year: 2040, value: 3.5 },
    ],
    NG: [
      { year: 1953, value: 4.0 },
      { year: 1979, value: 5.0 },
      { year: 1991, value: 2.0 },
      { year: 2019, value: 2.2 },
      { year: 2040, value: 3.0 },
    ],
  },
  unemploymentRate: {
    global: [
      { year: 1950, value: 4.5 },
      { year: 1980, value: 7.0 },
      { year: 1995, value: 5.8 },
      { year: 2019, value: 4.0 },
      { year: 2040, value: 4.2 },
    ],
    US: [
      { year: 1953, value: 4.5 },
      { year: 1979, value: 6.0 },
      { year: 1991, value: 6.8 },
      { year: 2019, value: 4.0 },
      { year: 2040, value: 4.2 },
    ],
    UK: [
      { year: 1953, value: 1.8 },
      { year: 1979, value: 5.0 },
      { year: 1991, value: 8.5 },
      { year: 2019, value: 4.0 },
      { year: 2040, value: 4.2 },
    ],
    DE: [
      { year: 1953, value: 7.0 },
      { year: 1979, value: 3.5 },
      { year: 1991, value: 6.0 },
      { year: 2019, value: 3.2 },
      { year: 2040, value: 3.5 },
    ],
    JP: [
      { year: 1953, value: 2.0 },
      { year: 1979, value: 2.0 },
      { year: 1991, value: 2.1 },
      { year: 2019, value: 2.4 },
      { year: 2040, value: 2.6 },
    ],
    IE: [
      { year: 1953, value: 8.0 },
      { year: 1979, value: 7.5 },
      { year: 1991, value: 14.0 },
      { year: 2019, value: 5.0 },
      { year: 2040, value: 5.0 },
    ],
    BR: [
      { year: 1953, value: 5.5 },
      { year: 1979, value: 6.5 },
      { year: 1991, value: 10.0 },
      { year: 2019, value: 12.0 },
      { year: 2040, value: 9.0 },
    ],
    CN: [
      { year: 1953, value: 4.5 },
      { year: 1979, value: 5.0 },
      { year: 1991, value: 3.0 },
      { year: 2019, value: 4.0 },
      { year: 2040, value: 4.5 },
    ],
    NG: [
      { year: 1953, value: 5.0 },
      { year: 1979, value: 7.0 },
      { year: 1991, value: 12.0 },
      { year: 2019, value: 14.0 },
      { year: 2040, value: 11.0 },
    ],
  },
  lifeExpectancy: {
    global: [
      { year: 1950, value: 68 },
      { year: 1970, value: 71 },
      { year: 1990, value: 75 },
      { year: 2019, value: 79 },
      { year: 2040, value: 82 },
    ],
    US: [
      { year: 1953, value: 68.5 },
      { year: 1979, value: 73.8 },
      { year: 1991, value: 75.5 },
      { year: 2019, value: 78.8 },
      { year: 2040, value: 82 },
    ],
    UK: [
      { year: 1953, value: 69.5 },
      { year: 1979, value: 73.5 },
      { year: 1991, value: 76 },
      { year: 2019, value: 81.2 },
      { year: 2040, value: 84 },
    ],
    DE: [
      { year: 1953, value: 67.5 },
      { year: 1979, value: 72.5 },
      { year: 1991, value: 75.5 },
      { year: 2019, value: 81 },
      { year: 2040, value: 84 },
    ],
    JP: [
      { year: 1953, value: 63 },
      { year: 1979, value: 76 },
      { year: 1991, value: 79 },
      { year: 2019, value: 84.4 },
      { year: 2040, value: 87 },
    ],
    IE: [
      { year: 1953, value: 66.9 },
      { year: 1979, value: 72.5 },
      { year: 1991, value: 75.5 },
      { year: 2019, value: 82.3 },
      { year: 2040, value: 85 },
    ],
    BR: [
      { year: 1953, value: 50 },
      { year: 1979, value: 61.5 },
      { year: 1991, value: 66.5 },
      { year: 2019, value: 75.5 },
      { year: 2040, value: 79 },
    ],
    CN: [
      { year: 1953, value: 42 },
      { year: 1979, value: 65 },
      { year: 1991, value: 69 },
      { year: 2019, value: 77 },
      { year: 2040, value: 81 },
    ],
    NG: [
      { year: 1953, value: 35 },
      { year: 1979, value: 44.5 },
      { year: 1991, value: 46 },
      { year: 2019, value: 54.5 },
      { year: 2040, value: 62 },
    ],
  },
  violentCrimeRate: {
    global: [
      { year: 1950, value: 180 },
      { year: 1970, value: 400 },
      { year: 1990, value: 700 },
      { year: 2005, value: 470 },
      { year: 2019, value: 380 },
      { year: 2040, value: 350 },
    ],
    US: [
      { year: 1953, value: 160 },
      { year: 1979, value: 550 },
      { year: 1991, value: 750 },
      { year: 2019, value: 380 },
      { year: 2040, value: 350 },
    ],
    UK: [
      { year: 1953, value: 80 },
      { year: 1979, value: 250 },
      { year: 1991, value: 400 },
      { year: 2019, value: 350 },
      { year: 2040, value: 320 },
    ],
    DE: [
      { year: 1953, value: 120 },
      { year: 1979, value: 200 },
      { year: 1991, value: 280 },
      { year: 2019, value: 220 },
      { year: 2040, value: 200 },
    ],
    JP: [
      { year: 1953, value: 150 },
      { year: 1979, value: 80 },
      { year: 1991, value: 50 },
      { year: 2019, value: 25 },
      { year: 2040, value: 25 },
    ],
    IE: [
      { year: 1953, value: 60 },
      { year: 1979, value: 150 },
      { year: 1991, value: 220 },
      { year: 2019, value: 200 },
      { year: 2040, value: 190 },
    ],
    BR: [
      { year: 1953, value: 300 },
      { year: 1979, value: 450 },
      { year: 1991, value: 700 },
      { year: 2019, value: 700 },
      { year: 2040, value: 650 },
    ],
    CN: [
      { year: 1953, value: 150 },
      { year: 1979, value: 100 },
      { year: 1991, value: 160 },
      { year: 2019, value: 90 },
      { year: 2040, value: 85 },
    ],
    NG: [
      { year: 1953, value: 250 },
      { year: 1979, value: 400 },
      { year: 1991, value: 550 },
      { year: 2019, value: 600 },
      { year: 2040, value: 550 },
    ],
  },
  povertyRate: {
    global: [
      { year: 1950, value: 22 },
      { year: 1970, value: 12.5 },
      { year: 1990, value: 13.5 },
      { year: 2019, value: 11 },
      { year: 2040, value: 10 },
    ],
    US: [
      { year: 1953, value: 26 },
      { year: 1979, value: 11.7 },
      { year: 1991, value: 14.2 },
      { year: 2019, value: 10.5 },
      { year: 2040, value: 9.5 },
    ],
    UK: [
      { year: 1953, value: 20 },
      { year: 1979, value: 13 },
      { year: 1991, value: 17 },
      { year: 2019, value: 12 },
      { year: 2040, value: 11 },
    ],
    DE: [
      { year: 1953, value: 22 },
      { year: 1979, value: 10 },
      { year: 1991, value: 11 },
      { year: 2019, value: 10.5 },
      { year: 2040, value: 10 },
    ],
    JP: [
      { year: 1953, value: 30 },
      { year: 1979, value: 12 },
      { year: 1991, value: 12 },
      { year: 2019, value: 15.5 },
      { year: 2040, value: 14 },
    ],
    IE: [
      { year: 1953, value: 30 },
      { year: 1979, value: 20 },
      { year: 1991, value: 21 },
      { year: 2019, value: 13 },
      { year: 2040, value: 11 },
    ],
    BR: [
      { year: 1953, value: 30 },
      { year: 1979, value: 26 },
      { year: 1991, value: 28 },
      { year: 2019, value: 21 },
      { year: 2040, value: 17 },
    ],
    CN: [
      { year: 1953, value: 30 },
      { year: 1979, value: 28 },
      { year: 1991, value: 24 },
      { year: 2019, value: 8 },
      { year: 2040, value: 6 },
    ],
    NG: [
      { year: 1953, value: 30 },
      { year: 1979, value: 27 },
      { year: 1991, value: 28 },
      { year: 2019, value: 26 },
      { year: 2040, value: 22 },
    ],
  },
};

function normalsToAnchors(metricId: string, normals: NormalAnchor[]): BandAnchor[] {
  const s = CORE5_SPREADS[metricId];
  return normals.map(({ year, value }) => ({
    year,
    best: Math.max(value + s.best, s.bestFloor ?? -Infinity),
    worst: Math.min(value + s.worst, s.worstCeil ?? Infinity),
  }));
}

function buildCore5Curves(): Record<string, MetricBandCurve> {
  const out: Record<string, MetricBandCurve> = {};
  for (const [metricId, byScope] of Object.entries(CORE5_NORMALS)) {
    const curve: MetricBandCurve = { byCountry: {} };
    for (const [scope, normals] of Object.entries(byScope)) {
      if (!normals) continue;
      const anchors = normalsToAnchors(metricId, normals);
      if (scope === "global") curve.global = anchors;
      else curve.byCountry![scope as CountryId] = anchors;
    }
    out[metricId] = curve;
  }
  return out;
}

export const METRIC_BAND_CURVES: Record<string, MetricBandCurve> = {
  ...buildCore5Curves(),

  // ── Distortion set (scored metrics whose 2019 band misjudges old eras) ──────
  publicTrust: {
    global: [
      { year: 1953, best: 90, worst: 40 },
      { year: 1979, best: 85, worst: 30 },
      { year: 1991, best: 82, worst: 25 },
      { year: 2019, best: 80, worst: 20 },
    ],
  },
  literacyRate: {
    global: [
      { year: 1953, best: 97, worst: 70 },
      { year: 1991, best: 98.5, worst: 78 },
      { year: 2019, best: 99, worst: 82 },
    ],
    byCountry: {
      CN: [
        { year: 1953, best: 50, worst: 15 },
        { year: 1979, best: 80, worst: 40 },
        { year: 1991, best: 88, worst: 55 },
        { year: 2019, best: 99, worst: 82 },
      ],
      NG: [
        { year: 1953, best: 30, worst: 8 },
        { year: 1979, best: 45, worst: 15 },
        { year: 1991, best: 60, worst: 25 },
        { year: 2019, best: 75, worst: 40 },
      ],
      BR: [
        { year: 1953, best: 60, worst: 25 },
        { year: 1979, best: 75, worst: 40 },
        { year: 1991, best: 85, worst: 55 },
        { year: 2019, best: 95, worst: 70 },
      ],
      // Turkey sat far below the global floor: the 1950 census put national
      // literacy near 32%, from roughly 15% in the eastern provinces to the
      // mid-50s in Istanbul. On the global 1953 band (worst 70) every Turkish
      // region scored a flat 0, so no Turkish education policy could move the
      // number at all. The village-institute and later literacy campaigns are
      // the whole point of the period here, and they need somewhere to land.
      TR: [
        { year: 1953, best: 60, worst: 12 },
        { year: 1979, best: 75, worst: 35 },
        { year: 1991, best: 85, worst: 55 },
        { year: 2019, best: 97, worst: 75 },
      ],
    },
  },
  debtToGdp: {
    global: [
      // "best" was 25 against a 1953 median of 22, so most of the world scored
      // 100 together. Postwar debt was concentrated in the belligerents (UK has
      // its own band below, US 68); for everyone else low debt was the era's
      // norm and needs room to differentiate.
      { year: 1953, best: 5, worst: 110 },
      { year: 1979, best: 20, worst: 90 },
      { year: 1991, best: 20, worst: 110 },
      { year: 2019, best: 20, worst: 140 },
    ],
    byCountry: {
      UK: [
        { year: 1953, best: 60, worst: 220 },
        { year: 1979, best: 30, worst: 120 },
        { year: 1991, best: 20, worst: 100 },
        { year: 2019, best: 20, worst: 140 },
      ],
    },
  },
  // Spec B fiscal teeth (flag-on): tighter than the global THRESHOLDS (worst -8)
  // so a moderate structural deficit bites sooner — the affordability penalty for
  // over-legislating. Extreme era deficits (17-48% of GDP) already peg this at 0.
  budgetBalance: {
    global: [
      { year: 1953, best: 3, worst: -6 },
      { year: 2019, best: 3, worst: -6 },
    ],
  },
  incarcerationRate: {
    global: [
      { year: 1953, best: 50, worst: 400 },
      { year: 2019, best: 50, worst: 800 },
    ],
    byCountry: {
      US: [
        { year: 1953, best: 50, worst: 350 },
        { year: 1979, best: 50, worst: 450 },
        { year: 1991, best: 50, worst: 750 },
        { year: 2019, best: 50, worst: 800 },
        { year: 2040, best: 50, worst: 700 },
      ],
    },
  },
  incomeInequality: {
    // 1953 best lowered 22→12 (#3238): the US 1953 seeds author Gini 15-42
    // around a 22 normal (the most-equal modern era) — with best=22 half the
    // country pinned at score 100 at seed and equality gains carried no signal.
    global: [
      { year: 1953, best: 12, worst: 45 },
      { year: 1979, best: 23, worst: 48 },
      { year: 1991, best: 24, worst: 52 },
      { year: 2019, best: 24, worst: 55 },
    ],
  },
  voterTurnout: {
    global: [
      { year: 1953, best: 90, worst: 45 },
      { year: 1979, best: 88, worst: 40 },
      { year: 2019, best: 85, worst: 30 },
    ],
  },
  civicParticipation: {
    global: [
      { year: 1953, best: 88, worst: 45 },
      { year: 1979, best: 84, worst: 38 },
      { year: 2019, best: 80, worst: 30 },
    ],
  },
  physicianRate: {
    global: [
      { year: 1953, best: 2.5, worst: 0.4 },
      { year: 1979, best: 3.5, worst: 0.7 },
      { year: 1991, best: 4, worst: 0.8 },
      { year: 2019, best: 5, worst: 1 },
    ],
  },
  preventableMortality: {
    global: [
      { year: 1953, best: 350, worst: 900 },
      { year: 1979, best: 220, worst: 700 },
      { year: 1991, best: 180, worst: 600 },
      { year: 2019, best: 120, worst: 500 },
    ],
  },
  airQuality: {
    global: [
      { year: 1953, best: 30, worst: 150 },
      { year: 1979, best: 20, worst: 110 },
      { year: 1991, best: 15, worst: 95 },
      { year: 2019, best: 8, worst: 80 },
    ],
  },
  highSchoolGradRate: {
    global: [
      { year: 1953, best: 70, worst: 25 },
      { year: 1979, best: 88, worst: 45 },
      { year: 1991, best: 92, worst: 52 },
      { year: 2019, best: 97, worst: 60 },
    ],
  },
  universityEnrollment: {
    global: [
      // Floor was 5, but the 1953 world's MEDIAN enrollment is 5 — so most of
      // the world sat at or under it and scored 0 together (NG 0.2, CN 0.5,
      // TR 0.8, BR and ES 2). Mass higher education is a 1960s phenomenon;
      // the floor has to be the bottom of the era, not of the modern band.
      { year: 1953, best: 25, worst: 0 },
      { year: 1979, best: 55, worst: 12 },
      { year: 1991, best: 65, worst: 18 },
      { year: 2019, best: 85, worst: 25 },
    ],
  },

  // ── Saturation set (#3238): metrics whose era-authentic 1953/1979 seed
  //    values pinned at 0/100 against the modern static band. Anchors are
  //    derived from the authored seed normals (stateMetrics1953/1979.ts and
  //    the per-country ${cc}MetricPresets1953/1979.ts files) so a freshly
  //    seeded era world lands mid-band and responds in both directions.
  //    INVARIANT: every 2019 anchor equals the static THRESHOLDS band exactly,
  //    and interpolateBand clamps beyond the last anchor — so year ≥ 2019
  //    scoring is byte-identical to the uncurved behavior (regression-tested
  //    in metricScoring.era.test.ts). Countries without a byCountry entry and
  //    without a global set keep the static band (getEraBand → null). ────────
  educationSpending: {
    // Nominal per-pupil, US-authored seeds only (other countries seed their
    // own currency scales and stay on the static band). Band shape mirrors
    // the modern geometry: best ≈ normal ×1.67, worst ≈ normal ×0.33.
    byCountry: {
      US: [
        { year: 1953, best: 585, worst: 115 }, // NCES 1953 normal ≈ $350
        { year: 1979, best: 3650, worst: 730 }, // NCES 1978-79 normal ≈ $2,200
        { year: 2019, best: 15000, worst: 3000 }, // = THRESHOLDS
      ],
    },
  },
  uninsuredRate: {
    // Pre-universal-coverage eras: high uninsured rates were structural, not
    // policy failure. Per-country normals from the era preset files. UK/DE
    // (early universal/statutory systems) already score mid on the static
    // band and are deliberately NOT curved.
    byCountry: {
      US: [
        { year: 1953, best: 13, worst: 68 }, // normal 38 (pre-Medicare/Medicaid)
        { year: 1979, best: 3, worst: 33 }, // normal 13
        { year: 2019, best: 0, worst: 22 }, // = THRESHOLDS
      ],
      JP: [
        { year: 1953, best: 15, worst: 70 }, // normal 40 (NHI universal only in 1961)
        { year: 1979, best: 0, worst: 22 }, // universal since 1961 → modern band
        { year: 2019, best: 0, worst: 22 },
      ],
      IE: [
        { year: 1953, best: 12, worst: 62 }, // normal 35 (Mother-and-Child defeat)
        { year: 2019, best: 0, worst: 22 },
      ],
      BR: [
        { year: 1953, best: 45, worst: 95 }, // normal 72
        { year: 1979, best: 28, worst: 88 }, // normal 55 (INPS formal workers only)
        { year: 2019, best: 0, worst: 22 },
      ],
      CN: [
        { year: 1953, best: 55, worst: 99 }, // normal 80 (pre-barefoot-doctors)
        { year: 1979, best: 15, worst: 70 }, // normal 40
        { year: 2019, best: 0, worst: 22 },
      ],
      NG: [
        { year: 1953, best: 85, worst: 100 }, // normal 95 (essentially no coverage)
        { year: 1979, best: 55, worst: 98 }, // normal ~85
        { year: 2019, best: 0, worst: 22 },
      ],
    },
  },
  crimeRate: {
    // US-authored era seeds only (1953 ≈ 1750, the historical property-crime
    // low; 1979 ≈ 5300, near peak — the modern band already fits 1979+).
    byCountry: {
      US: [
        { year: 1953, best: 500, worst: 5000 },
        { year: 1979, best: 1500, worst: 11000 }, // = THRESHOLDS
        { year: 2019, best: 1500, worst: 11000 },
      ],
    },
  },
  waterQuality: {
    // US 1953 seeds tier 60-92 (pre-Safe-Drinking-Water-Act); 1979 seeds 72-95.
    // The US row alone left every OTHER country falling through to the modern
    // THRESHOLDS (99/70), where a realistic 1953 supply floors — treated piped
    // water was a city privilege almost everywhere outside north-west Europe.
    // The global row is wider at the bottom than the US row for that reason.
    byCountry: {
      US: [
        { year: 1953, best: 95, worst: 40 },
        { year: 1979, best: 97, worst: 55 },
        { year: 2019, best: 99, worst: 70 }, // = THRESHOLDS
      ],
    },
    global: [
      { year: 1953, best: 88, worst: 30 },
      { year: 1979, best: 95, worst: 55 },
      { year: 2019, best: 99, worst: 70 }, // = THRESHOLDS
    ],
  },
  rdIntensity: {
    // All era preset files author 1953 normals 0.0-1.0 (defense-only R&D) and
    // 1979 normals ~0.9-2.0. Negative worst keeps a 0 value un-pinned (NG 1953
    // authors 0.0 as its era normal).
    global: [
      { year: 1953, best: 1.4, worst: -0.35 },
      { year: 1979, best: 2.6, worst: -0.4 },
      { year: 2019, best: 4.5, worst: 0.5 }, // = THRESHOLDS
    ],
  },
  exportDependency: {
    // Lower-is-better exposure metric: pre-globalization trade shares of 8-35
    // pinned at 100 against the modern {30,55} band. Global anchors fit the
    // 1953 preset normals (JP 18, DE 20, UK 25, BR 15, NG 28); the US
    // (autarkic, normal 8) gets its own tighter curve.
    global: [
      { year: 1953, best: 4, worst: 40 },
      { year: 1979, best: 8, worst: 48 },
      { year: 2019, best: 30, worst: 55 }, // = THRESHOLDS
    ],
    byCountry: {
      US: [
        { year: 1953, best: 2, worst: 25 },
        { year: 1979, best: 5, worst: 35 },
        { year: 2019, best: 30, worst: 55 },
      ],
    },
  },

  // ── Activation ramps (scored WINDOWED metrics; first anchor at `from`,
  //    `worst` below the value floor per the step-discontinuity rule so a
  //    just-activated ~0 value scores Fair, not 0/100) ───────────────────────
  broadbandAccess: {
    global: [
      { year: 1998, best: 15, worst: -40 },
      { year: 2008, best: 60, worst: 5 },
      { year: 2019, best: 99, worst: 50 },
    ],
  },
  // Utilities. Both are scored against a MODERN band otherwise
  // (powerGridReliability best 99.9 / worst 97 — a 2.9-point window), which no
  // 1953 grid on earth clears: a realistic early-Cold-War grid floors, while a
  // region that kept its un-overlaid modern seed scores 100. The family that
  // reads them (infrastructure.utilities) was noise in both directions.
  //
  // 1953 anchors: national grids exist across the industrial core but outages
  // are routine, and treated piped water is a city privilege almost everywhere
  // outside north-west Europe. The 2019 rows restate the static THRESHOLDS so
  // the modern era is unchanged by construction.
  powerGridReliability: {
    global: [
      { year: 1953, best: 98, worst: 84 },
      { year: 1979, best: 99.5, worst: 92 },
      { year: 2019, best: 99.9, worst: 97 },
    ],
  },
  // Roads and protected land. Neither is anachronistic — both existed in 1953 —
  // but both were scored against a MODERN band, where a realistic early-Cold-War
  // value floors: `protectedLand` worst is 3% when global coverage in 1953 was
  // about 1-3% TOTAL, so the whole world reads as "worst". Anchored so the
  // Eastern-bloc values already authored in easternBlocMetrics (1953 road 30,
  // protectedLand 2) land mid-range rather than at the bottom. 2019 rows restate
  // THRESHOLDS so the modern era is unchanged by construction.
  roadCondition: {
    global: [
      { year: 1953, best: 70, worst: 8 },
      { year: 1979, best: 82, worst: 25 },
      { year: 2019, best: 90, worst: 40 }, // = THRESHOLDS
    ],
  },
  protectedLand: {
    global: [
      { year: 1953, best: 4, worst: 0.1 },
      { year: 1979, best: 12, worst: 1 },
      { year: 2019, best: 50, worst: 3 }, // = THRESHOLDS
    ],
  },
  socialMediaSentiment: {
    global: [
      { year: 2004, best: 10, worst: -20 },
      { year: 2019, best: 15, worst: -15 },
    ],
  },
  renewableEnergy: {
    global: [
      { year: 1974, best: 12, worst: -30 },
      { year: 1991, best: 25, worst: -10 },
      { year: 2005, best: 45, worst: 0 },
      { year: 2019, best: 80, worst: 5 },
    ],
  },
  energyTransitionProgress: {
    global: [
      { year: 2000, best: 30, worst: -60 },
      { year: 2019, best: 90, worst: 20 },
    ],
  },
  carbonEmissions: {
    // Lower-is-better: no zero-cliff (a 0 value scores 100); era-authentic
    // higher emissions were normal at activation.
    global: [
      { year: 1990, best: 6, worst: 35 },
      { year: 2019, best: 3, worst: 25 },
    ],
  },
  recyclingRate: {
    global: [
      { year: 1972, best: 10, worst: -25 },
      { year: 1991, best: 30, worst: -5 },
      { year: 2019, best: 70, worst: 10 },
    ],
  },
  // ── P5: bands the 1953 data proved were carrying no signal ─────────────────
  // Each of these was measured, not guessed: every authored 1953 seed value was
  // scored against the static band, and these are the metrics where half or more
  // of the world pinned at 0 or 100. A pinned metric is worse than a wrong one —
  // policy cannot move it, so the player sees a permanent grade they can neither
  // earn nor fix, and approval built on it is a constant.

  militaryReadiness: {
    // Static band (85/25) put occupied and neutral states (IE, DE, AT at 15) at
    // 0 and both superpowers (US 85, RU 90) at 100 — the sharpest spread of the
    // Cold War, flattened to two values. Widening both ends restores the ranking
    // that actually existed.
    global: [
      { year: 1953, best: 95, worst: 10 },
      { year: 1979, best: 92, worst: 15 },
      { year: 2019, best: 85, worst: 25 },
    ],
  },
  pressFreedom: {
    // 1953 was genuinely bimodal, and scoring RU (3) and CN (5) badly is
    // correct — but a floor of 25 scored them identically to Spain (8) and to
    // each other. Dropping it keeps the verdict and restores the ordering
    // within the authoritarian bloc.
    global: [
      { year: 1953, best: 92, worst: 0 },
      { year: 1979, best: 92, worst: 5 },
      { year: 2019, best: 92, worst: 25 },
    ],
  },
  stateMediaControl: {
    // A ceiling of 85 meant CN and RU (98) and Spain (90) all scored 0. The
    // era's whole point is that state control varied enormously.
    global: [
      { year: 1953, best: 8, worst: 100 },
      { year: 1979, best: 8, worst: 98 },
      { year: 2019, best: 10, worst: 85 },
    ],
  },
  disinformationRisk: {
    // Pre-broadcast, pre-internet: authored 1953 values run 5-22 against a band
    // whose "best" is 10, so 85% of the world scored ~100 and the real variation
    // was invisible.
    global: [
      { year: 1953, best: 3, worst: 25 },
      { year: 1979, best: 5, worst: 40 },
      { year: 2019, best: 10, worst: 70 },
    ],
  },
  mediaPolarization: {
    global: [
      { year: 1953, best: 3, worst: 60 },
      { year: 1979, best: 5, worst: 70 },
      { year: 2019, best: 10, worst: 80 },
    ],
  },
  apprenticeshipRate: {
    // Apprenticeship was central to European economies in a way it is not now:
    // Austria 28, Russia and Finland 8, Germany 6 all hit the static ceiling of
    // 6 together. Raising it separates the dual-system economies; dropping the
    // floor to 0 stops Brazil and Nigeria (0.5) sharing a score with China (1).
    global: [
      { year: 1953, best: 12, worst: 0 },
      { year: 1979, best: 8, worst: 0.5 },
      { year: 2019, best: 6, worst: 1 },
    ],
  },
  productivityGrowth: {
    // Postwar reconstruction: Japan 8, Germany 7.5, China 6 against a ceiling of
    // 4 — the miracle economies were indistinguishable from merely adequate ones.
    global: [
      { year: 1953, best: 9, worst: 0 },
      { year: 1979, best: 5, worst: -1 },
      { year: 2019, best: 4, worst: -2 },
    ],
  },
  nationalPride: {
    // Postwar pride ran high nearly everywhere (median 72 against a ceiling of
    // 80). Raising it lets defeated and occupied states — Germany 50, Austria
    // and Japan 55 — read differently from Russia 85 and Britain 80.
    global: [
      { year: 1953, best: 92, worst: 45 },
      { year: 1979, best: 86, worst: 38 },
      { year: 2019, best: 80, worst: 30 },
    ],
  },
  housingAffordability: {
    // Housing was cheap against income in 1953 (median 20 on a band whose "best"
    // is 15), so most of the world scored ~100 and the metric could not respond
    // to policy. Russia's postwar urban housing crisis (60) is the top end the
    // ceiling has to reach.
    global: [
      { year: 1953, best: 5, worst: 65 },
      { year: 1979, best: 10, worst: 68 },
      { year: 2019, best: 15, worst: 70 },
    ],
  },
  climateResilience: {
    global: [
      { year: 2000, best: 40, worst: -50 },
      { year: 2019, best: 90, worst: 30 },
    ],
  },
};

export function getEraBand(
  metricId: string,
  countryId: string | undefined,
  year: number | null
): { best: number; worst: number } | null {
  if (year == null || !Number.isFinite(year)) return null;
  // medianIncome is composed from INCOME_ANCHORS × incomeBandIndex inside
  // metricScoring.getMetricThreshold — never served from a plain curve.
  if (metricId === "medianIncome") return null;
  const curve = METRIC_BAND_CURVES[metricId];
  if (!curve) return null;
  const anchors = (countryId && curve.byCountry?.[countryId as CountryId]) || curve.global;
  if (!anchors || anchors.length === 0) return null;
  return interpolateBand(anchors, year);
}

/**
 * Era envelopes — engine-side clamps for windowed ENGINE-ANIMATED metrics, so a
 * hidden 1953 broadband cannot saturate to modern values before its era.
 * Wave 1: CEILINGS only, authored ONLY for the scored higher-is-better animated
 * windowed set. Limit default = best + 0.15·|best| (sign-safe; NOT best×1.15).
 * Exemptions live in ENVELOPE_EXEMPTIONS with rationale (validated: every
 * animated windowed metric is enveloped or exempted).
 */
export const METRIC_ERA_ENVELOPES: Record<
  string,
  { anchors: Array<{ year: number; limit: number }> }
> = {
  // Limits = band best + 0.15·|best| at each band anchor year (sign-safe;
  // capped at the metric's playable ceiling). Validated ≥ band best everywhere.
  broadbandAccess: {
    anchors: [
      { year: 1998, limit: 17.25 },
      { year: 2008, limit: 69 },
      { year: 2019, limit: 100 },
    ],
  },
  socialMediaSentiment: {
    anchors: [
      { year: 2004, limit: 11.5 },
      { year: 2019, limit: 17.25 },
    ],
  },
  energyTransitionProgress: {
    anchors: [
      { year: 2000, limit: 34.5 },
      { year: 2019, limit: 100 },
    ],
  },
};

/** metricId → rationale for NOT having an envelope despite being animated + windowed. */
export const ENVELOPE_EXEMPTIONS: Record<string, string> = {
  carbonEmissions:
    "lower-is-better: engine saturation drifts toward 'good' modern values — hidden pre-window, plausible at activation; floor-style envelope is Wave-2",
  hseWaitingListMonths: "lower-is-better (see carbonEmissions)",
  directProvisionLoad: "lower-is-better (see carbonEmissions)",
  antiSocialBehaviourRate: "lower-is-better (see carbonEmissions)",
  agriEmissionsShare: "lower-is-better (see carbonEmissions)",
  devolutionSatisfaction:
    "unscored: no band curve to derive a default from, no scoring surface to distort",
  rentenStabilitaet: "unscored (see devolutionSatisfaction)",
  bundeswehrReadiness: "unscored (see devolutionSatisfaction)",
  roboticsAdoption: "unscored (see devolutionSatisfaction)",
  mentalHealthAccess: "unscored (see devolutionSatisfaction)",
  schuldenbremseHeadroom:
    "budget-MIRRORED (fiscalRatios + fiscalMirror re-derive it from the live budget each turn — era-consistent by construction)",
};

export function getEraEnvelope(
  metricId: string,
  countryId: string | undefined,
  year: number | null
): { limit: number; kind: "ceiling" } | null {
  if (year == null || !Number.isFinite(year)) return null;
  const env = METRIC_ERA_ENVELOPES[metricId];
  if (!env) return null;
  if (!IS_HIGHER_BETTER_LOCAL[metricId]) return null; // Wave 1: ceilings only
  if (!isMetricActive(metricId, countryId, year)) return { limit: 0, kind: "ceiling" };
  const a = env.anchors;
  if (a.length === 0) return null;
  const first = a[0];
  const last = a[a.length - 1];
  let limit: number;
  if (year <= first.year) limit = first.limit;
  else if (year >= last.year) limit = last.limit;
  else {
    limit = last.limit;
    for (let i = 1; i < a.length; i++) {
      if (year <= a[i].year) {
        const t = (year - a[i - 1].year) / (a[i].year - a[i - 1].year);
        limit = a[i - 1].limit + (a[i].limit - a[i - 1].limit) * t;
        break;
      }
    }
  }
  return { limit, kind: "ceiling" };
}

/**
 * Era display names: first entry whose `until` > year wins (entry applies while
 * year < until); falls through to the base definition name / regional override.
 */
export const METRIC_ERA_NAMES: Record<
  string,
  Array<{ until: number; name: string; shortName?: string }>
> = {
  gcseAttainment: [{ until: 1988, name: "O-Level Attainment", shortName: "O-Levels" }],
};

/**
 * Era-aware display name. Accepts a minimal definition shape so display-only
 * def variants (e.g. the metric-detail page's ALL_METRIC_DEFS entries) work
 * without a full MetricDefinition. Falls through to the per-region override
 * then the base name — same semantics as getMetricDisplayName.
 */
export function getEraMetricName(
  definition: Pick<MetricDefinition, "id" | "name"> & {
    regionDisplayNames?: Record<string, string>;
  },
  year: number | null,
  stateId?: string
): string {
  if (year != null && Number.isFinite(year)) {
    const eras = METRIC_ERA_NAMES[definition.id];
    const hit = eras?.find((e) => year < e.until);
    if (hit) return hit.name;
  }
  if (stateId && definition.regionDisplayNames) {
    const override = definition.regionDisplayNames[stateId.toUpperCase()];
    if (override) return override;
  }
  return definition.name;
}

/**
 * Activation events crossed in (prevYear, year]. One element per EVENT: the
 * base `from` (countries = window.countries ?? null meaning "all") and each
 * countryOverride (countries = [thatCountry], news = the override's own copy).
 */
export function getNewlyActivatedMetrics(
  prevYear: number,
  year: number
): Array<{ metricId: string; news: EraNews; countries: CountryId[] | null }> {
  const out: Array<{ metricId: string; news: EraNews; countries: CountryId[] | null }> = [];
  for (const [metricId, w] of Object.entries(METRIC_ERA_WINDOWS)) {
    if (w.from > prevYear && w.from <= year) {
      out.push({ metricId, news: w.news, countries: w.countries ?? null });
    }
    for (const [cid, ov] of Object.entries(w.countryOverrides ?? {})) {
      if (ov && ov.from > prevYear && ov.from <= year) {
        out.push({ metricId, news: ov.news, countries: [cid as CountryId] });
      }
    }
  }
  return out;
}

/**
 * Per-country nominal median income "normal" by year, LOCAL currency. SSOT for
 * era-seed income values AND the flag-on income band (metricScoring composes
 * band = anchor(startingYear) × shape × incomeBandIndex). Task 8 authors all
 * 8 countries; interpolated between years, clamped at the ends.
 */
export const INCOME_ANCHORS: Partial<Record<CountryId, Array<{ year: number; value: number }>>> = {
  // ── 1953-only countries (P5) ───────────────────────────────────────────────
  // These eight had NO anchor at all, so `getIncomeAnchor` returned null and
  // medianIncome fell through to the modern static band — 1953 Italy's $550 was
  // scored against a $15k-$90k range and read 0, as did most of the others.
  //
  // Each value is that country's own authored national median from its
  // `*MetricPresets1953.ts`, which the GDP-scale guard
  // (`medianIncomeGdpScale1953.test.ts`) already validates as correctly
  // denominated — the same re-anchoring UK and IE got above, rather than a
  // fresh derivation that could reintroduce the scale bug.
  //
  // ONE anchor each, deliberately: all eight are seeded for 1953 only, so there
  // is no later era to interpolate toward, and inventing a 1979 value would mean
  // modelling the franc and markka redenominations against seeds that do not
  // exist. The band therefore holds flat if such a world runs forward — worth
  // revisiting if these countries ever gain a second era, but far better than
  // scoring them against 2019.
  IT: [{ year: 1953, value: 550 }], // USD-anchored, per itMetricPresets1953's header
  FR: [{ year: 1953, value: 420_000 }], // anciens francs
  ES: [{ year: 1953, value: 14_000 }], // pesetas
  SE: [{ year: 1953, value: 8_000 }], // kronor
  TR: [{ year: 1953, value: 1_900 }], // lira
  AT: [{ year: 1953, value: 18_400 }], // schilling
  FI: [{ year: 1953, value: 292_500 }], // old markka (pre-1963 reform)
  GR: [{ year: 1953, value: 9_300 }], // drachma

  // Median household income "normal" per era, LOCAL currency, hand-authored to
  // sit near each country's seed income scale (see MEDIAN_INCOME_THRESHOLDS
  // derivation notes). Reviewed at dry-run before any flag flip.
  US: [
    { year: 1953, value: 4_200 },
    { year: 1979, value: 16_500 },
    { year: 1991, value: 30_000 },
    { year: 2019, value: 65_000 },
  ],
  UK: [
    // 1953 re-anchored from 4,300 to 450 (#income-gdp-scale-audit) to match
    // ukMetricPresets1953.ts's newly-authored national medianIncome — the old
    // 4,300 measured out at ratio ~15.1x GDP/capita (£14.4B / 50.6M ≈ £284.6;
    // medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]) and traced to
    // `1979 nominal (11,000) x Maddison REAL GDP/capita 1953:1979 ratio` — a
    // real-volume ratio applied to a nominal value, same defect class as
    // IE/BR/CN/DD/RU above. 450 gives ratio ~1.58x, next to the US 1953
    // reference point (1.59x). Same 1953->1979 discontinuity caveat as IE/BR
    // above: not reconciled, flagged only.
    { year: 1953, value: 450 },
    { year: 1979, value: 11_000 },
    { year: 1991, value: 15_500 },
    { year: 2019, value: 30_000 },
  ],
  DE: [
    { year: 1953, value: 4_800 },
    { year: 1979, value: 21_000 },
    { year: 1991, value: 28_000 },
    { year: 2019, value: 47_000 },
  ],
  JP: [
    // 1953: USD-anchored (~¥250k / 360 JPY/USD; refs #3498). Later eras stay in JPY.
    { year: 1953, value: 700 },
    { year: 1979, value: 2_900_000 },
    { year: 1991, value: 4_500_000 },
    { year: 2019, value: 5_500_000 },
  ],
  IE: [
    // 1953 re-anchored from 3,100 to 180 (#income-gdp-scale-audit) to match
    // ieMetricPresets1953.ts's newly-authored national medianIncome (the
    // overlay previously had none at all, so 1953 Ireland silently used
    // ieStateMetrics.ts's MODERN income — see that file's doc comment). 180
    // sits at ratio ~1.55x the 1953 budget's GDP/capita (£IR 340M / 2.96M =
    // £IR 115; medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]); the old
    // 3,100 implied a ~27x ratio. NOTE: this leaves a large 1953->1979 jump
    // (180 -> 8,500) that this audit did not attempt to reconcile — 1979 is
    // out of scope here and its own anchor was not re-derived from a GDP
    // ratio, so the two may not be on the same curve. Flagged, not fixed.
    { year: 1953, value: 180 },
    { year: 1979, value: 8_500 },
    { year: 1991, value: 13_000 },
    { year: 2019, value: 45_000 },
  ],
  BR: [
    // 1953 re-anchored from 900 to 7,500 (#income-gdp-scale-audit) to match
    // brMetricPresets1953.ts's newly-authored national medianIncome — the old
    // 900 tracked applyEra1953Adjustments's US-anchor-ratio scaling of the
    // modern BR bundle, which measured ratio ~0.39x GDP/capita (Cr$ 330B /
    // 57M = Cr$ 5,789; band is [0.8, 2.6]), under-scaled. Same 1953->1979
    // discontinuity caveat as IE above: not reconciled, flagged only.
    { year: 1953, value: 7_500 },
    { year: 1979, value: 6_000 },
    { year: 1991, value: 14_000 },
    { year: 2019, value: 27_000 },
  ],
  CN: [
    // #income-gdp-scale-audit: re-anchored again, this time to $80 — the
    // OPPOSITE correction from #3498's below. That pass moved this anchor to
    // a CNY-nominal 1,000 on the theory the seed "stays in CNY", but the 1953
    // CN BUDGET (NATIONAL_BUDGET_SEED_CONFIGS_1953) is actually USD-anchored
    // ($33.3B, like US/DE/JP/NG/IT — currencyCode CNY is display-only there),
    // and cnMetricPresets1953.ts's overlay is the actual income the game
    // seeds. Re-authoring the overlay to $80 (matching the GDP's real
    // convention; medianIncomeGdpScale1953.test.ts ratio ~1.45, band [0.8,
    // 2.6]) means this anchor must track dollars again, not yuan.
    //
    // #3498's original problem (income-band index landing at the FX rate,
    // 2.54, instead of ~1) was real, but its fix pointed the wrong direction —
    // the seed and the budget need to agree on ONE convention, and the
    // budget's is USD.
    { year: 1953, value: 80 },
    { year: 1979, value: 3_500 },
    { year: 1991, value: 9_000 },
    { year: 2019, value: 90_000 },
  ],
  NG: [
    // 1953: USD-anchored colonial household income (~£50–60 WAP × $2.80; refs #3498).
    // Later eras stay in NGN.
    { year: 1953, value: 150 },
    { year: 1979, value: 90_000 },
    { year: 1991, value: 210_000 },
    { year: 2019, value: 1_100_000 },
  ],
  // East Germany exists only in the 1953 and 1979 presets (reunified Oct 1990).
  // Without an entry here getIncomeAnchor returns null and metricScoring falls
  // through to the GLOBAL medianIncome band (best 90,000 / worst 15,000 USD),
  // which DD's seeded 5,900-8,800 Mark der DDR sits entirely below — pinning
  // its income score at 0 for the whole run with no way for policy to move it.
  DD: [
    // Matches ddStateMetrics1953.ts (annual household Mark der DDR). Rescaled
    // from 7,000 to 4,900 (#income-gdp-scale-audit) alongside that file's own
    // rescale — the old figure measured a hair's-width (2.594x, margin 0.006)
    // under the medianIncomeGdpScale1953.test.ts [0.8, 2.6] ceiling.
    { year: 1953, value: 4_900 },
    { year: 1979, value: 14_000 },
  ],
  RU: [
    // Authored with the political-legislation build (spec §4.1): RU's legacy
    // stateMetrics seed carries a COMPRESSED game-scale medianIncome (₽4,000
    // household) and these anchors follow that seed scale per this table's rule.
    // The law cost engine deliberately does NOT use these — it has its own
    // history-scaled COST_INCOME_ANCHORS (src/lib/politicalLegislation).
    //
    // 1953 re-anchored again to ₽10,500 (#income-gdp-scale-audit) to match
    // `ruMetricPresets1953.ts`'s corrected national figure (regions now
    // ₽7,200-15,800) — the prior ₽1,600 measured out at ratio 0.213x GDP per
    // capita (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]) and
    // undershot the real average Soviet MONTHLY wage of the early 1950s
    // (~700-720 pre-1961 rubles) by roughly a factor of 5. Keep this anchor
    // synced to the overlay's own scale per this table's stated rule.
    { year: 1953, value: 10_500 },
    { year: 1979, value: 4_000 },
    { year: 1991, value: 4_500 },
    { year: 2019, value: 5_500 },
  ],
};

export function getIncomeAnchor(countryId: string | undefined, year: number | null): number | null {
  if (!countryId || year == null || !Number.isFinite(year)) return null;
  const a = INCOME_ANCHORS[countryId as CountryId];
  if (!a || a.length === 0) return null;
  if (year <= a[0].year) return a[0].value;
  if (year >= a[a.length - 1].year) return a[a.length - 1].value;
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i].year) {
      const t = (year - a[i - 1].year) / (a[i].year - a[i - 1].year);
      return a[i - 1].value + (a[i].value - a[i - 1].value) * t;
    }
  }
  return a[a.length - 1].value;
}

/**
 * Era shift for MODIFIER CONDITION thresholds (approvalModifiers): conditions
 * are authored against the modern world, so a condition value translates by
 * how far the band curve's midpoint has moved from its modern (2019-anchor)
 * midpoint. Derived entirely from the curve — no standalone reference table;
 * 0 when the metric is uncurved, at 2019, or when year is null (legacy).
 */
export function getEraConditionShift(
  metricId: string,
  countryId: string | undefined,
  year: number | null | undefined
): number {
  if (year == null || !Number.isFinite(year)) return 0;
  const at = getEraBand(metricId, countryId, year);
  if (!at) return 0;
  const ref = getEraBand(metricId, countryId, 2019);
  if (!ref) return 0;
  return (at.best + at.worst) / 2 - (ref.best + ref.worst) / 2;
}

/** Linear interp between anchors, clamped at both ends (mirrors the old expectations.ts). */
export function interpolateBand(
  anchors: BandAnchor[],
  year: number
): { best: number; worst: number } {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (year <= first.year) return { best: first.best, worst: first.worst };
  if (year >= last.year) return { best: last.best, worst: last.worst };
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return { best: a.best + (b.best - a.best) * t, worst: a.worst + (b.worst - a.worst) * t };
    }
  }
  return { best: last.best, worst: last.worst };
}
