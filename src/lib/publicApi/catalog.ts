/** Machine-readable public v1 route catalog shared by meta and OpenAPI. */
export const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/public/v1/game",
    description: "Current game state and turn timing.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/character",
    description: "Search characters by name (partial) or discordId.",
    params: [
      { name: "name", required: false },
      { name: "discordId", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/characterSearch",
    description: "Alias of /character.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/characters/bulk",
    description: "Bulk character lookup by comma-separated sequential ids (max 100).",
    params: [{ name: "ids", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]",
    description: "Full character detail by sequential id or ObjectId.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]/career",
    description: "Character career history.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]/achievements",
    description: "Character achievements.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/party",
    description: "Party details.",
    params: [
      { name: "id", required: true },
      { name: "country", required: true },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/parties",
    description: "All parties for a country with seat counts.",
    params: [{ name: "country", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country",
    description: "List all countries.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]",
    description: "Country details.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/legislature",
    description: "Legislature composition and bills.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/economy",
    description: "Economic indicators for a country.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/budget",
    description: "National revenue, spending, debt, tax rates, and fiscal indicators.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/regions",
    description: "Regional population, GDP, representation, political lean, and top sectors.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/metrics",
    description: "National and regional quality-of-life metrics with trends and extremes.",
    params: [
      { name: "code", required: true, inPath: true },
      { name: "category", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/history",
    description: "Country event log (leader changes, bills, referendums).",
    params: [
      { name: "limit", required: false },
      { name: "type", required: false },
      { name: "beforeTurn", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/battles",
    description: "Recent battle reports involving a country.",
    params: [
      { name: "limit", required: false },
      { name: "code", required: true, inPath: true },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/conflicts",
    description: "Conflicts filtered by country and/or status.",
    params: [
      { name: "country", required: false },
      { name: "status", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/government",
    description: "Government overview for a country.",
    params: [{ name: "country", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections",
    description:
      "Active elections for a country. Pass results=true for per-candidate vote standings on every race in one call.",
    params: [
      { name: "country", required: true },
      { name: "state", required: false },
      { name: "results", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections/archives",
    description: "Completed elections with winners.",
    params: [
      { name: "country", required: true },
      { name: "type", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections/[id]",
    description: "Election detail with candidates, votes, phases.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/news",
    description: "News feed.",
    params: [
      { name: "limit", required: false },
      { name: "category", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/legislation",
    description: "Bills and votes, filterable by status.",
    params: [
      { name: "country", required: false },
      { name: "status", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/market",
    description: "Stock market data by sector.",
    params: [
      { name: "type", required: true },
      { name: "country", required: false },
      { name: "page", required: false },
      { name: "view", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/bonds",
    description: "Bond market data.",
    params: [
      { name: "corp", required: false },
      { name: "page", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/commodities",
    description: "Commodity market data.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/commodity/[key]",
    description: "Commodity detail with optional country pricing.",
    params: [
      { name: "key", required: true, inPath: true },
      { name: "country", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/forex",
    description: "Current rates, targets, volumes, regimes, and intervention bands.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/forex/[currency]",
    description: "Currency detail with bounded rate history.",
    params: [
      { name: "currency", required: true, inPath: true },
      { name: "history", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/trade/tariffs",
    description: "Active tariff layers with bill and target provenance.",
    params: [
      { name: "country", required: false },
      { name: "targetCountry", required: false },
      { name: "scope", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/trade/embargoes",
    description: "Active ministerial, legislative, and organization trade restrictions.",
    params: [
      { name: "country", required: false },
      { name: "includePending", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/sovereigns",
    description: "Sovereign debt demand, sustainability, ratings, and crisis state.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/funds",
    description: "Index funds; ?slug=SLUG for detail with top holdings.",
    params: [
      { name: "slug", required: false },
      { name: "country", required: false },
      { name: "scope", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporations",
    description: "List all corporations.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporation",
    description: "Corporation detail; id is the sequentialId.",
    params: [
      { name: "name", required: false },
      { name: "id", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporation/shares/history",
    description: "Public share-trade tape for one corporation.",
    params: [
      { name: "name", required: false },
      { name: "id", required: false },
      { name: "page", required: false },
      { name: "pageSize", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/leaderboard",
    description: "Player rankings by metric.",
    params: [
      { name: "metric", required: false },
      { name: "country", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/referendums",
    description: "Referendum campaigns, polling, party positions, and resolved results.",
    params: [
      { name: "country", required: false },
      { name: "status", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/referendums/[id]",
    description: "Referendum detail by ObjectId.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/organizations",
    description: "International organizations, members, leadership, and activity counts.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/organizations/[id]",
    description: "Organization charter, proposals, resolutions, votes, and elections.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/economy/history",
    description:
      "Bounded monetary, growth, inflation, fiscal, and sovereign debt history for a country.",
    params: [
      { name: "code", required: true, inPath: true },
      { name: "fromTurn", required: false },
      { name: "toTurn", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/trade/flows",
    description: "Bounded world, country, and commodity trade-flow history.",
    params: [
      { name: "country", required: false },
      { name: "commodity", required: false },
      { name: "fromTurn", required: false },
      { name: "toTurn", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/openapi.json",
    description: "OpenAPI 3.1 contract for every public v1 route.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/meta",
    description: "Machine-readable catalog of the public v1 interface.",
    params: [],
  },
] as const;
