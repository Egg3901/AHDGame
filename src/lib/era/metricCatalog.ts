import type { CountryId } from "@/lib/constants/countries";
import { metricCategories, type MetricDefinition } from "@/lib/constants/metricDefinitions";
import { JP_INCOME_ANCHORS } from "@/lib/countries/jp/geographyFacts";
import { JP_NUCLEAR_SAFETY_WINDOW } from "@/lib/countries/jp/data/jpMetricOverrides";
import { AT_INCOME_ANCHORS } from "@/lib/countries/at/geographyFacts";
import { BR_INCOME_ANCHORS } from "@/lib/countries/br/geographyFacts";
import { CN_INCOME_ANCHORS } from "@/lib/countries/cn/geographyFacts";
import { DD_INCOME_ANCHORS } from "@/lib/countries/dd/geographyFacts";
import { DE_INCOME_ANCHORS } from "@/lib/countries/de/geographyFacts";
import { ES_INCOME_ANCHORS } from "@/lib/countries/es/geographyFacts";
import { FI_INCOME_ANCHORS } from "@/lib/countries/fi/geographyFacts";
import { FR_INCOME_ANCHORS } from "@/lib/countries/fr/geographyFacts";
import { GR_INCOME_ANCHORS } from "@/lib/countries/gr/geographyFacts";
import { IE_INCOME_ANCHORS } from "@/lib/countries/ie/geographyFacts";
import { IT_INCOME_ANCHORS } from "@/lib/countries/it/geographyFacts";
import { NG_INCOME_ANCHORS } from "@/lib/countries/ng/geographyFacts";
import { RU_INCOME_ANCHORS } from "@/lib/countries/ru/geographyFacts";
import { SE_INCOME_ANCHORS } from "@/lib/countries/se/geographyFacts";
import { TR_INCOME_ANCHORS } from "@/lib/countries/tr/geographyFacts";
import { UK_INCOME_ANCHORS } from "@/lib/countries/uk/geographyFacts";
import { US_INCOME_ANCHORS } from "@/lib/countries/us/geographyFacts";

import { METRIC_BAND_CURVES, CORE5_NORMALS } from "./metricBandCurves";
import type { BandAnchor, MetricBandCurve, NormalAnchor } from "./metricCatalogTypes";

export { METRIC_BAND_CURVES, CORE5_NORMALS };
export type { BandAnchor, MetricBandCurve, NormalAnchor };

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
      JP: JP_NUCLEAR_SAFETY_WINDOW,
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
    from: 1979,
    countries: ["UK"],
    news: {
      title: "The Devolution Debate",
      body: "The balance of power between Westminster and the regions is on the political agenda. Proposals for devolved governments offer a choice about where domestic decisions should be made. Parliament can establish a settlement, amend existing powers or retain central control.\n\nCitizens will judge whether regional government brings representation, effective services and accountability. The passage of time does not settle the argument: the institutions that emerge depend on enacted laws and the choices made in this world.",
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
      title: "Europe Weighs Closer Union",
      body: "The Maastricht debate puts closer European integration before member governments. The Community's common market continues while each member decides whether to ratify a European Union treaty. Rejection can delay or prevent that settlement; the calendar does not decide the outcome.\n\nFor Germany, cooperation with its neighbours remains a test of political trust and economic coordination. European cohesion measures that relationship whether the Community continues or a ratified Union takes its place. The institutions in force depend on the decisions made in this world.",
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
  IT: IT_INCOME_ANCHORS, // USD-anchored, per itMetricPresets1953's header
  FR: FR_INCOME_ANCHORS, // anciens francs
  ES: ES_INCOME_ANCHORS, // pesetas
  SE: SE_INCOME_ANCHORS, // kronor
  TR: TR_INCOME_ANCHORS, // lira
  AT: AT_INCOME_ANCHORS, // schilling
  FI: FI_INCOME_ANCHORS, // old markka (pre-1963 reform)
  GR: GR_INCOME_ANCHORS, // drachma

  // Median household income "normal" per era, LOCAL currency, hand-authored to
  // sit near each country's seed income scale (see MEDIAN_INCOME_THRESHOLDS
  // derivation notes). Reviewed at dry-run before any flag flip.
  US: US_INCOME_ANCHORS,
  UK: UK_INCOME_ANCHORS,
  DE: DE_INCOME_ANCHORS,
  JP: JP_INCOME_ANCHORS,
  IE: IE_INCOME_ANCHORS,
  BR: BR_INCOME_ANCHORS,
  CN: CN_INCOME_ANCHORS,
  NG: NG_INCOME_ANCHORS,
  // East Germany exists only in the 1953 and 1979 presets (reunified Oct 1990).
  // Without an entry here getIncomeAnchor returns null and metricScoring falls
  // through to the GLOBAL medianIncome band (best 90,000 / worst 15,000 USD),
  // which DD's seeded 5,900-8,800 Mark der DDR sits entirely below — pinning
  // its income score at 0 for the whole run with no way for policy to move it.
  DD: DD_INCOME_ANCHORS,
  RU: RU_INCOME_ANCHORS,
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
