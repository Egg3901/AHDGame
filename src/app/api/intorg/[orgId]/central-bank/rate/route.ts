import { POST as countryPost } from "@/app/api/country/[code]/central-bank/rate/route";
import {
  countryCentralBankContext,
  resolveIntorgCentralBankCountry,
  type IntorgRouteContext,
} from "../_helpers";

export async function POST(request: Request, context: IntorgRouteContext) {
  const resolved = await resolveIntorgCentralBankCountry(context);
  if ("response" in resolved) return resolved.response;
  return countryPost(request, countryCentralBankContext(resolved.countryId));
}
