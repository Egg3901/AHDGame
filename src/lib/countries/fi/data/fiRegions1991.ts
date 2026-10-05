/**
 * FI 1991 regional bundle. Population, seats and geography retain the existing
 * inputs (Finland has no dated 1991 population total authored yet). GDP is the
 * authored regional shares scaled to the sourced 1991 national nominal total in
 * legacy currency (WDI NY.GDP.MKTP.CN, see fiscalAnchors1991.ts); the shares are
 * model estimates, not observed regional accounts. Values are millions.
 */
import { fiRegions } from "./fiRegions";
import { scaleRegionalGdpToNational } from "@/lib/seeds/reference/rules/anchorBudget1991";
import { gdp1991LegacyLcu } from "@/lib/constants/fiscalAnchors1991";

export const fiRegions1991 = scaleRegionalGdpToNational(fiRegions, gdp1991LegacyLcu("FI"));
