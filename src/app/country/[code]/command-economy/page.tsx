import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";
import BackButton from "@/components/BackButton";
import CommandEconomyDashboardView from "@/components/economy/commandEconomy/CommandEconomyDashboard";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[id];
  if (!config) return { title: "Command Economy | A House Divided" };
  return {
    title: `Command Economy | ${config.name} | A House Divided`,
    description: `Run ${config.name}'s planned economy: the national plan, state enterprises, and Gosbank credit.`,
  };
}

export default async function CommandEconomyPage({ params }: PageProps) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) notFound();
  // Only command / dual-track countries have this surface at all. The dashboard
  // itself gates on the live flag + regime; a country with no office map never
  // renders it.
  if (!commandEconomyOffices(countryId)) notFound();

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-8">
        <div className="mb-6 flex items-center gap-3">
          <BackButton iconOnly />
          <div>
            <h1 className="text-xl font-bold text-foreground">{config.name} Command Economy</h1>
            <p className="text-sm text-muted">
              The national plan, the state enterprises, and Gosbank credit.
            </p>
          </div>
        </div>
        <CommandEconomyDashboardView countryId={countryId} />
      </main>
    </div>
  );
}
