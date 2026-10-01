import { describe, expect, it } from "vitest";
import { productArea } from "./productArea";

describe("named product areas", () => {
  it.each([
    ["/", "landing"],
    ["/register", "registration"],
    ["/create-character", "character_creation"],
    ["/profile", "profile"],
    ["/corporation/opaque-id", "corporations"],
    ["/banking", "banking"],
    ["/news/post/opaque-id", "media"],
    ["/elections/opaque-id/results", "elections"],
    ["/country/DE/parties/2", "parties"],
    ["/country/US/region/CA/party/1", "parties"],
    ["/country/DE/stockmarket/fund/player-created-slug", "markets"],
    ["/country/US/forex/USD", "markets"],
    ["/country/US/central-bank/savings", "banking"],
    ["/country/DE/region/BE/legislature/bills/opaque-id", "legislation"],
    ["/world/conflicts/combat", "military"],
    ["/world/conflicts/opaque-id", "conflicts"],
    ["/world/crises/opaque-id", "crises"],
    ["/world/international-organizations/opaque-id", "diplomacy"],
    ["/world/trade", "markets"],
    ["/country/US/command-economy", "economy"],
    ["/country/US/executive/cabinet/opaque-id", "government"],
    ["/country/US/region/CA", "regions"],
    ["/country/US", "nations"],
    ["/portfolio/corporation/opaque-id", "markets"],
    ["/actions/canvass", "player_actions"],
    ["/campaign/opaque-id", "campaigns"],
  ])("maps %s to the controlled area %s", (pathname, area) => {
    expect(productArea(pathname)).toBe(area);
  });

  it.each(["/admin/users", "/moderator", "/settings", "/login", "/unknown/player-name"])(
    "does not invent areas for %s",
    (pathname) => expect(productArea(pathname)).toBeNull()
  );
});
