import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { YU_1953 } from "./1953";
import { YU_1979 } from "./1979";
import { YU_1991 } from "./1991";
import { YU_1999 } from "./1999";
import { YU_2007 } from "./2007";
import { YU_2019 } from "./2019";
import { YU_2023 } from "./2023";
import { YU_2027 } from "./2027";

/**
 * YU's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving YU without an era.
 *
 * ⚠ CONFIG OVERRIDES: 1953-default. `getCountryConfig` merges SHALLOWLY,
 * so an override supplying `legislature` replaces the base one wholesale -- every
 * field it omits is gone, not inherited.
 */
export const YU_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": YU_1953,
  "1979-default": YU_1979,
  "1991-default": YU_1991,
  "1999-default": YU_1999,
  "2007-default": YU_2007,
  "2019-default": YU_2019,
  "2023-default": YU_2023,
  "2027-default": YU_2027,
};
