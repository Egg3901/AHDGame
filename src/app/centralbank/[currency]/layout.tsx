import { notFound } from "next/navigation";
import { getCountryDisplayName } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import { getCountryAccess } from "@/lib/countryAccess";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getGameState } from "@/lib/gameState";
import { resolveCentralBankCurrency } from "@/lib/centralBank/currencyRouting";

interface Props {
  params: Promise<{ currency: string }>;
  children: React.ReactNode;
}

/**
 * Access gate for currency-scoped central-bank pages, applied to the currency's
 * anchor country. Mirrors `src/app/country/[code]/layout.tsx` — keep the two in
 * step.
 */
export default async function CurrencyCentralBankLayout({ params, children }: Props) {
  const { currency } = await params;
  const resolved = resolveCentralBankCurrency(currency);
  if (!resolved) notFound();
  const anchor = resolved.anchorCountryId;

  const [access, user, gameState] = await Promise.all([
    getCountryAccess(anchor),
    getAuthUserWithCharacter(),
    getGameState(),
  ]);
  const isAdmin = user?.isAdmin === true;
  const name = getCountryDisplayName(anchor, gameState?.preset);

  if (isAdmin) {
    return (
      <>
        {!access.enabledForPlayers && (
          <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 text-center text-sm text-warning">
            {access.econOnly
              ? "Econ-only nation — players can view every page here, but cannot act."
              : "This country is not registered. Only admins can see this."}
          </div>
        )}
        {children}
      </>
    );
  }

  if (access.enabledForPlayers) {
    return <>{children}</>;
  }

  if (access.econOnly) {
    return (
      <>
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 text-center text-sm text-primary">
          {name} is an econ-only nation. You can view every page here, but you cannot run for
          office, join a party, or vote.
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <CountryFlag country={anchor} width={60} height={40} />
      <h1 className="text-2xl font-bold text-foreground">{name}</h1>
      <p className="max-w-md text-muted">
        This country is currently under development. Check back soon!
      </p>
    </div>
  );
}
