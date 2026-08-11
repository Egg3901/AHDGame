// Response types for /api/news/wire. Shared with UI consumers via lib so they
// don't reach into the route file.

export interface WireItem {
  id: string;
  type:
    | "corporation_founded"
    | "corporation_relocated"
    | "corporation_dissolved"
    | "bond_issued"
    | "dividend_changed"
    | "corp_credit_rating"
    | "system_news"
    | "pvp_action";
  headline: string;
  timestamp: string;
  href?: string;
}
