import { redirect, notFound } from "next/navigation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import type { Corporation } from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * Country-scoped entry point to the public State Ownership Register. Resolves the
 * country's primary National Corporation and lands on its Register tab (which
 * renders the country-wide takings/privatization history). Lets the National
 * Budget treasury panel deep-link the register without knowing the NatCorp id.
 * Falls back to the nationalization hub if the country has no National Corporation.
 */
export default async function StateOwnershipRegisterRedirect({ params }: PageProps) {
  const { code } = await params;
  const lower = code.toLowerCase();
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    notFound();
  }

  const db = await getDb();
  const corps = db.collection<Corporation>("corporations");
  const natCorp =
    (await corps.findOne(
      { countryOwnerId: countryId, isPrimaryNationalCorporation: true },
      { projection: { _id: 1 } }
    )) ?? (await corps.findOne({ countryOwnerId: countryId }, { projection: { _id: 1 } }));

  if (!natCorp) {
    redirect(`/country/${lower}/nationalization`);
  }
  redirect(`/corporation/${natCorp._id.toString()}?tab=register`);
}
