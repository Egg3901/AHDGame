import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { TR_1953 } from "./1953";
import { TR_1979 } from "./1979";
import { TR_1991 } from "./1991";
import { TR_1999 } from "./1999";
import { TR_2007 } from "./2007";
import { TR_2019 } from "./2019";
import { TR_2023 } from "./2023";
import { TR_2027 } from "./2027";

/**
 * TR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving TR without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const TR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": TR_1953,
  "1979-default": TR_1979,
  "1991-default": TR_1991,
  "1999-default": TR_1999,
  "2007-default": TR_2007,
  "2019-default": TR_2019,
  "2023-default": TR_2023,
  "2027-default": TR_2027,
};
