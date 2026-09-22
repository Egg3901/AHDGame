import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { FR_1953 } from "./1953";
import { FR_1979 } from "./1979";
import { FR_1991 } from "./1991";
import { FR_1999 } from "./1999";
import { FR_2007 } from "./2007";
import { FR_2019 } from "./2019";
import { FR_2023 } from "./2023";
import { FR_2027 } from "./2027";

/**
 * FR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving FR without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const FR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": FR_1953,
  "1979-default": FR_1979,
  "1991-default": FR_1991,
  "1999-default": FR_1999,
  "2007-default": FR_2007,
  "2019-default": FR_2019,
  "2023-default": FR_2023,
  "2027-default": FR_2027,
};
