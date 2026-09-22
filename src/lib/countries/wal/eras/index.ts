import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { WAL_1953 } from "./1953";
import { WAL_1979 } from "./1979";
import { WAL_1991 } from "./1991";
import { WAL_1999 } from "./1999";
import { WAL_2007 } from "./2007";
import { WAL_2019 } from "./2019";
import { WAL_2023 } from "./2023";
import { WAL_2027 } from "./2027";

/**
 * WAL's per-era overrides, one per shipping preset.
 *
 * ⚠ EVERY preset in `SHIPPING_PRESETS` gets a file -- 8 of them. The count is
 * asserted against the roster in `contract.test.ts` rather than a literal, so a
 * new preset fails loudly here instead of silently leaving WAL without an era.
 *
 * ⚠ WAL HAS NO CONFIG OVERRIDE IN ANY ERA. Every preset uses the base config.
 */
export const WAL_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": WAL_1953,
  "1979-default": WAL_1979,
  "1991-default": WAL_1991,
  "1999-default": WAL_1999,
  "2007-default": WAL_2007,
  "2019-default": WAL_2019,
  "2023-default": WAL_2023,
  "2027-default": WAL_2027,
};
