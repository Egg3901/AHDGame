import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { IT_1953 } from "./1953";
import { IT_1979 } from "./1979";
import { IT_1991 } from "./1991";
import { IT_1999 } from "./1999";
import { IT_2007 } from "./2007";
import { IT_2019 } from "./2019";
import { IT_2023 } from "./2023";
import { IT_2027 } from "./2027";

/**
 * IT's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving IT without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const IT_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": IT_1953,
  "1979-default": IT_1979,
  "1991-default": IT_1991,
  "1999-default": IT_1999,
  "2007-default": IT_2007,
  "2019-default": IT_2019,
  "2023-default": IT_2023,
  "2027-default": IT_2027,
};
