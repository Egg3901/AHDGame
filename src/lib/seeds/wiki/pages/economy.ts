import type { WikiSeedPage } from "../types";
import { corporationsContent } from "../content/corporations";
import { corporateRAndDContent } from "../content/corporateRAndD";
import { brandLoyaltyContent } from "../content/brandLoyalty";
import { outputQualityContent } from "../content/outputQuality";
import { supplyAgreementsContent } from "../content/supplyAgreements";
import { corporateBondsContent } from "../content/corporateBonds";
import { labourAndWagesContent } from "../content/labourAndWages";
import { unionsContent } from "../content/unions";
import { sovereignBondsContent } from "../content/sovereignBonds";
import { stockMarketContent } from "../content/stockMarket";
import { commoditiesContent } from "../content/commodities";
import { marketSystemGuideContent } from "../content/marketSystemGuide";
import { plantsCorpGuideContent } from "../content/plantsCorpGuide";
import { logisticsGuideContent } from "../content/logisticsGuide";
import { privateBankingContent } from "../content/privateBanking";
import { currencyExchangeContent } from "../content/currencyExchange";
import { centralBanksContent } from "../content/centralBanks";
import { plannedEconomiesContent } from "../content/plannedEconomies";
import { nationalBudgetContent } from "../content/nationalBudget";
import { nationalMetricsContent } from "../content/nationalMetrics";
import { governmentApprovalContent } from "../content/governmentApproval";
import { nationalizationContent } from "../content/nationalization";
import { nationalCorporationsContent } from "../content/nationalCorporations";
import { indexFundsContent } from "../content/indexFunds";
import { lineOfCreditContent } from "../content/lineOfCredit";
import { savingsInterestContent } from "../content/savingsInterest";
import { sovereignDefaultContent } from "../content/sovereignDefault";
import { imfContent } from "../content/imf";
import { corporateMergersContent } from "../content/corporateMergers";
import { subsidiaryCorporationsContent } from "../content/subsidiaryCorporations";
import { pensionsContent } from "../content/pensions";
import { imfSovereignFacilityContent } from "../content/imfSovereignFacility";
import { interbankLendingContent } from "../content/interbankLending";
import { fomcContent } from "../content/fomc";

export const economyPages: readonly WikiSeedPage[] = [
  {
    slug: "corporations",
    title: "Corporations",
    description:
      "How to found and run a corporation: sectors as owned plants, revenue, profit margins, splits and attacks, and political interactions.",
    content: corporationsContent,
    category: "economy",
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 11,
    designDocUrl: "design/corporations.html",
  },
  {
    slug: "corporate-r-and-d",
    title: "Corporate R&D & Tech Trees",
    description:
      "Decade-tiered tech trees with Corporate and Sector lanes, exclusive Scale, Premium, or Resilience specializations, R&D Score + cash unlocks, and innovation breakthroughs.",
    content: corporateRAndDContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "brand-loyalty",
    title: "Brand Loyalty",
    description:
      "How corporations earn and lose customer loyalty through consistent pricing and delivery: the relative loyal-slice payoff, the gouging penalty, and the hidden 5-tier scale.",
    content: brandLoyaltyContent,
    category: "economy",
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "output-quality",
    title: "Output Quality",
    description:
      "How corporations produce quality from four substitutable pillars: Tech, Inputs, Wages, and Operations: how quality propagates up the supply chain, and the visible average-quality number and chart.",
    content: outputQualityContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "supply-agreements",
    title: "Supply Agreements",
    description:
      "Private supplier-to-buyer commodity contracts: contracted demand filled before the open market, the ±35% price band, mutual consent, exclusivity, and the brand-loyalty interaction.",
    content: supplyAgreementsContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 5,
  },
  {
    slug: "labour-and-wages",
    title: "Labour & Wages",
    description:
      "Explicit sector labour costs, the CEO wage slider, minimum-wage floors, and macro links to median income, unemployment, and migration.",
    content: labourAndWagesContent,
    category: "economy",
    extraTags: ["wages", "unions"],
    designDocUrl: "design/labour.html",
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "unions",
    title: "Unions",
    description:
      "Sector unionization, standing labour premiums, strikes, union law, player-run unions, and union-busting: phased behind labour tiers.",
    content: unionsContent,
    category: "economy",
    extraTags: ["labour", "strikes"],
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "corporate-bonds",
    title: "Corporate Bonds",
    description:
      "Issuing corporate debt, coupon payments, credit ratings, market price dynamics, and default mechanics.",
    content: corporateBondsContent,
    category: "economy",
    extraTags: ["debt", "credit"],
    designDocUrl: "design/corporate-bond-defaults.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "sovereign-bonds",
    title: "Sovereign Bonds",
    description:
      "Government-issued bonds that finance national deficits: automatic issuance, coupon rates, and budget integration.",
    content: sovereignBondsContent,
    category: "economy",
    extraTags: ["debt", "treasury"],
    designDocUrl: "design/sovereign-bonds.html",
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "stock-market",
    title: "Stock Market",
    description:
      "How corporate shares are valued, how to buy and sell on country exchanges, and how dividends work.",
    content: stockMarketContent,
    category: "economy",
    extraTags: ["shares", "valuation"],
    designDocUrl: "design/stock-market.html",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "commodities",
    title: "Commodities",
    description:
      "The 28-commodity market: supply, demand, dynamic pricing, three-tier margin blends, and how shortages affect corporate margins.",
    content: commoditiesContent,
    category: "economy",
    extraTags: ["prices", "supply"],
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "market-system-guide",
    title: "Market System: A Player's Guide",
    description:
      "A plain-language guide to the market system tiers: price realization, cheapest-first clearing and pricing posture, the capital loop, the plants tier where sectors are their plants, and how it all flows into valuation.",
    content: marketSystemGuideContent,
    category: "economy",
    extraTags: [
      "market",
      "clearing",
      "capital",
      "plants",
      "price-realization",
      "capacity",
      "valuation",
    ],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 10,
  },
  {
    slug: "plants-corp-guide",
    title: "Running a Corporation under the Plants System",
    description:
      "The player's guide to the physical-capacity economy: founding, plant builds, sector numbers, unsold output, inventory, stranded-plant warnings, mothballing, bonds, and dominance costs. With screenshots.",
    content: plantsCorpGuideContent,
    category: "economy",
    extraTags: [
      "plants",
      "capacity",
      "corporations",
      "build-queue",
      "mothball",
      "unsold-output",
      "break-even",
    ],
    featured: true,
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 12,
  },
  {
    slug: "logistics-guide",
    title: "Logistics: Freight, Sourcing, and Supply Chains",
    description:
      "A visual player guide to freight markets, the Logistics map, landed-price sourcing, domestic haul capacity, and where to build logistics sectors.",
    content: logisticsGuideContent,
    category: "economy",
    extraTags: ["logistics", "freight", "sourcing", "supply-chain", "teu"],
    featured: true,
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "private-banking",
    title: "Private Banking",
    description:
      "How finance corporations charter banks, allocate branch capacity, set rates, take deposits, lend, survive runs, meet capital rules, and use proprietary trading.",
    content: privateBankingContent,
    category: "economy",
    extraTags: ["banking", "deposits", "loans", "insurance", "capital", "prop-trading"],
    featured: true,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 10,
  },
  {
    slug: "currency-exchange",
    title: "Currency Exchange",
    description:
      "The Forex system: four floating currencies, how rates are computed each turn, and how to trade for profit.",
    content: currencyExchangeContent,
    category: "economy",
    extraTags: ["forex", "fx"],
    designDocUrl: "design/currency-exchange.html",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "planned-economies",
    title: "Planned / Command Economies",
    description:
      "How USSR, China, and Eastern-bloc planned economies differ from market rules: fixed FX, administered prices, soft budgets, shortage and overhang, and dual-track transitions.",
    content: plannedEconomiesContent,
    category: "economy",
    extraTags: ["command", "shortage", "overhang", "dual-track", "china", "ussr"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "central-banks",
    title: "Central Banks",
    description:
      "The Central Bank Chair position, prime rate mechanics, and how interest rates ripple through the entire economy.",
    content: centralBanksContent,
    category: "economy",
    extraTags: ["fed", "prime-rate", "monetary"],
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "fomc",
    title: "FOMC / Rate-Setting Board",
    description:
      "The 7-seat central-bank board: meetings every 8 turns, 24-hour player votes, majority of the full board, 16 rate changes per 192-turn term.",
    content: fomcContent,
    category: "economy",
    extraTags: ["fed", "prime-rate", "monetary", "central-banks"],
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 4,
    lastUpdated: "2026-08-20",
  },
  {
    slug: "national-budget",
    title: "National Budget",
    description:
      "Revenue sources, spending categories, surplus and deficit mechanics, and how legislation shapes national finances.",
    content: nationalBudgetContent,
    category: "economy",
    extraTags: ["deficit", "treasury"],
    designDocUrl: "design/national-budget.html",
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 7,
  },
  {
    slug: "national-metrics",
    title: "National Metrics",
    description:
      "GDP, unemployment, inflation, and the dozens of state-level metrics that measure economic and social health.",
    content: nationalMetricsContent,
    category: "economy",
    extraTags: ["gdp", "inflation"],
    designDocUrl: "design/national-metrics.html",
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
  },
  {
    slug: "government-approval",
    title: "Government Approval",
    description:
      "How approval ratings are derived, what moves them each turn, and their role in snap election triggers.",
    content: governmentApprovalContent,
    category: "economy",
    extraTags: ["approval", "metrics"],
    designDocUrl: "design/government-approval.html",
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "nationalization",
    title: "Nationalization & National Corporations",
    description:
      "The state-ownership lifecycle: when a government can take a corporation, compensation tiers, investor confidence, running state-owned enterprises, and privatization.",
    content: nationalizationContent,
    category: "economy",
    featured: true,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 9,
  },
  {
    slug: "national-corporations",
    title: "National Corporations",
    description:
      "Running the state's own enterprises: primary and split-off corporations, public-service mandates, CEO operations, treasury backing and remittance, efficiency, state-ownership concentration, and privatization.",
    content: nationalCorporationsContent,
    category: "economy",
    extraTags: ["nationalization", "state-owned-enterprise", "soe"],
    featured: true,
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 10,
  },
  {
    slug: "index-funds",
    title: "Index Funds",
    description:
      "Passive investment vehicles that track a market basket: NAV, subscribe/redeem, and the 75/25 dividend pass-through.",
    content: indexFundsContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "line-of-credit",
    title: "Line of Credit",
    description:
      "Borrowing against your credit score from the central bank: composite scoring, spread curve, funding sources, and garnishment.",
    content: lineOfCreditContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "savings-interest",
    title: "Savings & Interest",
    description:
      "How idle cash earns interest at half the prime rate, accruing every turn and crediting quarterly.",
    content: savingsInterestContent,
    category: "economy",
    difficulty: "beginner",
    contentType: "guide",
    estimatedReadTime: 4,
  },
  {
    slug: "sovereign-default",
    title: "Sovereign Default",
    description:
      "The sovereign default crisis pipeline: failed auctions, demand penalty curve, resolution paths, default scar, and recovery floor.",
    content: sovereignDefaultContent,
    category: "economy",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "imf",
    title: "IMF & Bailouts",
    description:
      "The IMF bailout facility: income capture, share-price discount, level-annuity repayment, and board membership.",
    content: imfContent,
    category: "economy",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "corporate-mergers",
    title: "Corporate Mergers & Acquisitions",
    description:
      "Proposing and accepting whole-corporation acquisitions: reference valuation, shareholder buyout, and the merger review gate that can block or condition a deal.",
    content: corporateMergersContent,
    category: "economy",
    extraTags: ["m-and-a"],
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 7,
  },
  {
    slug: "subsidiary-corporations",
    title: "Subsidiary Corporations",
    description:
      "Formalizing voting control over another player's corporation: capital injection, dividend floors, CEO appointment, spin-offs, and group tax relief.",
    content: subsidiaryCorporationsContent,
    category: "economy",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 8,
  },
  {
    slug: "pensions",
    title: "Pensions",
    description:
      "Union-bargained occupational pensions: employer contributions, deficit top-ups, benefit payments, and how a scheme's funding health is measured.",
    content: pensionsContent,
    category: "economy",
    difficulty: "intermediate",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "imf-sovereign-facility",
    title: "IMF Sovereign Facility",
    description:
      "The country-level IMF bailout after a sovereign default crisis: loan sizing, income-capture repayment, and the IMF board's override window.",
    content: imfSovereignFacilityContent,
    category: "economy",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 6,
  },
  {
    slug: "interbank-lending",
    title: "Interbank Lending",
    description:
      "Bank-to-bank lending, the central bank margin line, and what happens to a failed bank's outstanding loan book.",
    content: interbankLendingContent,
    category: "economy",
    difficulty: "advanced",
    contentType: "guide",
    estimatedReadTime: 6,
  },
];
