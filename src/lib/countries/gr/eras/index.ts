import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { GR_1953 } from "./1953";
import { GR_1979 } from "./1979";
import { GR_1991 } from "./1991";
import { GR_1999 } from "./1999";
import { GR_2007 } from "./2007";
import { GR_2019 } from "./2019";
import { GR_2023 } from "./2023";
import { GR_2027 } from "./2027";

/**
 * GR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving GR without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const GR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": GR_1953,
  "1979-default": GR_1979,
  "1991-default": GR_1991,
  "1999-default": GR_1999,
  "2007-default": GR_2007,
  "2019-default": GR_2019,
  "2023-default": GR_2023,
  "2027-default": GR_2027,
};
