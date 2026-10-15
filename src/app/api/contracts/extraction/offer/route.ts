import { errorResponse } from "@/lib/api/errors";

/** Player-directed offers have been replaced by country-scoped tender publication. */
export async function POST() {
  return errorResponse(
    410,
    "Direct offers have been replaced by government contract bidding. Publish a country tender instead."
  );
}
