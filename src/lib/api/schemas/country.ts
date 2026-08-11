import { z } from "zod";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";

/** Zod schema that validates a string is a valid CountryId */
export const countryIdSchema = z.enum(ZOD_COUNTRY_ENUM);
