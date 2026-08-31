// POST /api/country/[code]/executive/cabinet/acting — the President installs an
// acting cabinet member without legislative confirmation.
// Auth: requireBasicAuth, must be the seated President of the country.
// Errors: 400, 401, 403, 404, 409, 429
import { type CountryId } from "@/lib/constants/countries";
import { appointActingCabinetMember } from "@/lib/cabinet/appointActing";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return appointActingCabinetMember(request, code.toUpperCase() as CountryId);
}
