import type { CountryEraOverride } from "../../contract";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";

/** Nigeria's 1991 regional GDP is stored in circulating naira, not the shared unit. */
export const NG_1991: CountryEraOverride = {
  preset: "1991-default",
  config: { usdExchangeRate: 1 / INITIAL_RATES_1991.NG! },
};
