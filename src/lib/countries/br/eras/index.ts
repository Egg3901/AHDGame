import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { BR_1953 } from "./1953";
import { BR_1979 } from "./1979";
import { BR_1991 } from "./1991";
import { BR_1999 } from "./1999";
import { BR_2007 } from "./2007";
import { BR_2019 } from "./2019";
import { BR_2023 } from "./2023";
import { BR_2027 } from "./2027";

/**
 * BR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving BR without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const BR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": BR_1953,
  "1979-default": BR_1979,
  "1991-default": BR_1991,
  "1999-default": BR_1999,
  "2007-default": BR_2007,
  "2019-default": BR_2019,
  "2023-default": BR_2023,
  "2027-default": BR_2027,
};
