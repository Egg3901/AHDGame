import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { UK_1953 } from "./1953";
import { UK_1979 } from "./1979";
import { UK_1991 } from "./1991";
import { UK_1999 } from "./1999";
import { UK_2007 } from "./2007";
import { UK_2019 } from "./2019";
import { UK_2023 } from "./2023";
import { UK_2027 } from "./2027";

/**
 * UK's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving UK without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default, 1991-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const UK_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": UK_1953,
  "1979-default": UK_1979,
  "1991-default": UK_1991,
  "1999-default": UK_1999,
  "2007-default": UK_2007,
  "2019-default": UK_2019,
  "2023-default": UK_2023,
  "2027-default": UK_2027,
};
