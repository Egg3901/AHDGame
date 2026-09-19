import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { SCO_1953 } from "./1953";
import { SCO_1979 } from "./1979";
import { SCO_1991 } from "./1991";
import { SCO_1999 } from "./1999";
import { SCO_2007 } from "./2007";
import { SCO_2019 } from "./2019";
import { SCO_2023 } from "./2023";
import { SCO_2027 } from "./2027";

/**
 * SCO's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving SCO without an era.
 *
 * ⚠ SCO HAS NO CONFIG OVERRIDE IN ANY ERA. Every preset uses the base config.
 */
export const SCO_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": SCO_1953,
  "1979-default": SCO_1979,
  "1991-default": SCO_1991,
  "1999-default": SCO_1999,
  "2007-default": SCO_2007,
  "2019-default": SCO_2019,
  "2023-default": SCO_2023,
  "2027-default": SCO_2027,
};
