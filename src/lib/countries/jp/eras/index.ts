import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryEraOverride } from "../../contract";
import { JP_1953 } from "./1953";
import { JP_1979 } from "./1979";
import { JP_1991 } from "./1991";
import { JP_1999 } from "./1999";
import { JP_2007 } from "./2007";
import { JP_2019 } from "./2019";
import { JP_2023 } from "./2023";

/**
 * Japan's per-era overrides, one per shipping preset.
 *
 * ⚠️ ALL SEVEN presets get a file, including 1999 and 2007. An earlier revision
 * listed five and dropped those two, for which Japan carries real region, census
 * and demographic data.
 *
 * ⚠️ Japan has TWO config overrides, 1953 and 1991, and 1953 carries a full
 * 466/248 legislature. A table naming only 1991 loses it silently, which is why
 * eraConfigOverrides.test.ts now pins both.
 */
export const JP_ERAS: Partial<Record<ShippingPreset, CountryEraOverride>> = {
  "1953-default": JP_1953,
  "1979-default": JP_1979,
  "1991-default": JP_1991,
  "1999-default": JP_1999,
  "2007-default": JP_2007,
  "2019-default": JP_2019,
  "2023-default": JP_2023,
};
