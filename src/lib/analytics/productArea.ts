/** Named gameplay areas, without exposing URLs, entity names or free-form slugs. */
export function productArea(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[0];
  if (!root) return "landing";
  if (root === "register") return "registration";
  if (root === "create-character" || root === "create-imperial-character")
    return "character_creation";
  if (root === "profile" || root === "character" || root === "retired" || root === "imperial")
    return "profile";
  if (root === "corporation" || root === "corporations" || root === "sectors")
    return "corporations";
  if (root === "banking" || root === "centralbank") return "banking";
  if (root === "news") return "media";
  if (root === "elections" || root === "president") return "elections";
  if (root === "campaign") return "campaigns";
  if (root === "parties" || root === "unions" || root === "charters") return "parties";
  if (
    root === "portfolio" ||
    root === "stockmarket" ||
    root === "bond" ||
    root === "forex" ||
    root === "commodity"
  )
    return "markets";
  if (root === "actions" || root === "political-operations" || root === "player-ads")
    return "player_actions";
  if (root === "congress" || root === "policy") return "legislation";
  if (root === "whitehouse" || root === "officials") return "government";
  if (root === "budget") return "economy";
  if (root === "world") {
    if (segments.includes("crises") || segments.includes("crisis")) return "crises";
    if (
      segments.includes("combat") ||
      segments.includes("military") ||
      segments.includes("station")
    )
      return "military";
    if (segments.includes("conflicts")) return "conflicts";
    if (segments.includes("trade")) return "markets";
    return "diplomacy";
  }
  if (root === "intorg" || root === "international") return "diplomacy";
  if (root === "country" || root === "state" || root === "uk") {
    if (segments.includes("party") || segments.includes("parties") || segments.includes("unions"))
      return "parties";
    if (segments.includes("elections") || segments.includes("referendums")) return "elections";
    if (segments.includes("stockmarket") || segments.includes("forex")) return "markets";
    if (segments.includes("central-bank")) return "banking";
    if (segments.includes("legislature") || segments.includes("policy")) return "legislation";
    if (segments.includes("general") || segments.includes("navair")) return "military";
    if (
      segments.includes("budget") ||
      segments.includes("economy") ||
      segments.includes("command-economy") ||
      segments.includes("state-ownership") ||
      segments.includes("nationalization")
    )
      return "economy";
    if (segments.includes("executive") || segments.includes("office")) return "government";
    if (segments.includes("region") || root === "state" || root === "uk") return "regions";
    return "nations";
  }
  if (root === "dashboard" || root === "map") return "world_overview";
  return null;
}
