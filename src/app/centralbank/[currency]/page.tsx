import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { resolveCountryIdentities } from "@/lib/country/countryIdentity";
import {
  resolveCentralBankCurrency,
  getCurrencyMemberCountries,
} from "@/lib/centralBank/currencyRouting";
import CentralBankClient from "./CentralBankClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ currency: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { currency } = await params;
  const resolved = resolveCentralBankCurrency(currency);
  if (!resolved) return { title: "Central Bank Not Found | A House Divided" };
  const bankName = resolved.config.centralBank.name;
  return {
    title: `${bankName} | A House Divided`,
    description: `${bankName} - prime rate, credit rating scale, and monetary policy.`,
  };
}

export default async function CurrencyCentralBankPage({ params }: PageProps) {
  const { currency } = await params;
  const resolved = resolveCentralBankCurrency(currency);
  if (!resolved) notFound();

  const db = await getDb();
  const [registered, gameState] = await Promise.all([
    getRegisteredCountryIds(db),
    getGameState(db),
  ]);
  const memberIds = getCurrencyMemberCountries(resolved.code, registered);
  // A currency no registered country uses (only CAD today) has no live bank page.
  if (memberIds.length === 0) notFound();

  // One primed read for the whole member list rather than one per country.
  const identities = await resolveCountryIdentities(db, memberIds, gameState?.preset);
  const members = memberIds
    .map((id) => ({
      countryId: id,
      name: identities.get(id)?.name ?? id,
      isIssuer: id === resolved.anchorCountryId,
    }))
    .sort((a, b) => Number(b.isIssuer) - Number(a.isIssuer));

  return (
    <CentralBankClient
      countryId={resolved.anchorCountryId}
      apiBasePath={resolved.apiBasePath}
      members={members}
    />
  );
}
