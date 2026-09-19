import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { BLR_1953 } from "./1953";
import { BLR_1979 } from "./1979";
import { BLR_1991 } from "./1991";
import { BLR_1999 } from "./1999";
import { BLR_2007 } from "./2007";
import { BLR_2019 } from "./2019";
import { BLR_2023 } from "./2023";
import { BLR_2027 } from "./2027";

/**
 * BLR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving BLR without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const BLR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": BLR_1953,
  "1979-default": BLR_1979,
  "1991-default": BLR_1991,
  "1999-default": BLR_1999,
  "2007-default": BLR_2007,
  "2019-default": BLR_2019,
  "2023-default": BLR_2023,
  "2027-default": BLR_2027,
};
