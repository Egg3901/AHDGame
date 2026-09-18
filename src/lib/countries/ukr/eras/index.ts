import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { UKR_1953 } from "./1953";
import { UKR_1979 } from "./1979";
import { UKR_1991 } from "./1991";
import { UKR_1999 } from "./1999";
import { UKR_2007 } from "./2007";
import { UKR_2019 } from "./2019";
import { UKR_2023 } from "./2023";
import { UKR_2027 } from "./2027";

/**
 * UKR's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving UKR without an era.
 *
 * ⚠ UKR HAS NO CONFIG OVERRIDE IN ANY ERA. Every preset uses the base config.
 */
export const UKR_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": UKR_1953,
  "1979-default": UKR_1979,
  "1991-default": UKR_1991,
  "1999-default": UKR_1999,
  "2007-default": UKR_2007,
  "2019-default": UKR_2019,
  "2023-default": UKR_2023,
  "2027-default": UKR_2027,
};
