import Image from "next/image";
import Link from "next/link";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { Avatar } from "@/components/Avatar";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { RegionDropdown } from "@/components/RegionDropdown";
import { RelocateButton } from "@/components/RelocateButton";
import { Tooltip } from "@/components/Tooltip";
import type { CountryId } from "@/lib/constants/countries";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { formatLeanValue, getLeanLabel, getSocialLeanLabel } from "@/lib/utils/demographics";
import { positionBucketHex, usesEuropeanLeanColours } from "@/lib/utils/politics";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";

/** The regional chief executive as the region page serializes it. */
export interface RegionHeaderExecutive {
  characterId: string | null;
  characterName: string | null;
  partyAbbreviation: string | null;
  partyColor: string | null;
  avatarUrl: string | null;
  borderKey: string | null;
  tintColor: string | null;
  nppId: string | null;
  characterSequentialId: number | null;
  nppSequentialId: number | null;
}

export interface RegionHeaderProps {
  regionId: string;
  regionName: string;
  countryId: CountryId;
  countryName: string;
  countryHref: string;
  /** Region page URL; the figures link into its tabs. */
  regionHref: string;
  /** Prefix line set above the name, e.g. "The Commonwealth of". */
  descriptor: string;
  flagSrc: string | null;
  bannerSrc: string | null;
  population: string;
  gdp: string;
  districts: { label: string; count: number };
  leans: { economicLean: number; socialLean: number } | null;
  approval: { value: number; base: number; modifiers: ActiveModifier[]; href: string } | null;
  executiveLabel: string;
  executive: RegionHeaderExecutive | null;
  /** Link to the executive's office, for the holder, officers of an NPP-held office and admins. */
  officeHref: string | null;
  motto: string | null;
  /** Irish regions list the councils they are made of. */
  comprising: string[] | null;
  relocate: {
    userHomeState?: string;
    userCountryId?: string;
  };
  currentParty: Parameters<typeof RegionDropdown>[0]["currentParty"];
}

const FACT_LINK =
  "text-body-lg font-semibold tabular-nums text-foreground underline decoration-transparent underline-offset-4 transition-colors hover:decoration-foreground/40";

function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Takes the full row in the two-column phone grid. */
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function executiveHref(executive: RegionHeaderExecutive): string | null {
  if (executive.characterId) {
    return buildCharacterHref({
      sequentialId: executive.characterSequentialId ?? undefined,
      _id: executive.characterId,
    });
  }
  if (executive.nppId) {
    return buildNppHref({
      sequentialId: executive.nppSequentialId ?? undefined,
      _id: executive.nppId,
    });
  }
  return null;
}

/**
 * Region page header: one card with a photographic band carrying the region's
 * identity and controls, and the key figures in a row beneath it. Each figure links to the tab
 * that explains it, so the header doubles as a way into the page.
 *
 * The band keeps `overflow-hidden` off its own element (the photo is clipped
 * by an inner wrapper) because clipping the band hid the RegionDropdown menu
 * (#915).
 */
export function RegionHeader(props: RegionHeaderProps) {
  const {
    regionId,
    regionName,
    countryId,
    countryName,
    countryHref,
    regionHref,
    descriptor,
    flagSrc,
    bannerSrc,
    population,
    gdp,
    districts,
    leans,
    approval,
    executiveLabel,
    executive,
    officeHref,
    motto,
    comprising,
    relocate,
    currentParty,
  } = props;
  const holderHref = executive ? executiveHref(executive) : null;
  const european = usesEuropeanLeanColours(countryId);
  const executiveName = executive && holderHref ? (executive.characterName ?? "Unknown") : null;

  return (
    <header className="rounded-xl border border-card-border bg-card">
      <div className="relative rounded-t-xl">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-xl"
          aria-hidden
        >
          {bannerSrc && (
            <HeroImage
              src={bannerSrc}
              alt=""
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 100vw, 1280px"
              priority
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/30" />
          <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/60 to-transparent" />
        </div>

        <div className="relative flex min-h-[13rem] flex-col justify-between gap-8 px-5 pb-6 pt-4 sm:min-h-[15rem] sm:px-8 sm:pb-8">
          <div className="flex items-center justify-between gap-3">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-body">
              <BackButton iconOnly />
              <Link
                href={countryHref}
                className="truncate text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                {countryName}
              </Link>
              <span className="text-white/50" aria-hidden>
                /
              </span>
              <RegionDropdown
                regionId={regionId}
                regionName={regionName}
                regionCountryId={countryId}
                currentParty={currentParty}
              />
            </nav>
            <RelocateButton
              targetStateId={regionId}
              targetName={regionName}
              userHomeState={relocate.userHomeState}
              userCountryId={relocate.userCountryId}
              targetCountryId={countryId}
              redirectPath={regionHref}
            />
          </div>

          <div className="flex items-end gap-4">
            {flagSrc && (
              <Image
                src={flagSrc}
                alt={`${regionName} flag`}
                width={72}
                height={48}
                className="mb-1 hidden h-12 w-[72px] shrink-0 rounded object-cover ring-1 ring-white/20 sm:block"
                unoptimized
              />
            )}
            <div className="min-w-0">
              <p className="text-body text-white/75">{descriptor}</p>
              <h1
                data-coach="nav-region"
                className="truncate text-display font-bold leading-tight tracking-tight text-white sm:text-[2.25rem]"
              >
                {regionName}
              </h1>
              {motto && (
                <p className="mt-1 truncate text-body text-white/70" title={motto}>
                  {motto}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-card-border px-5 py-5 sm:flex sm:flex-wrap sm:gap-x-12 sm:px-8">
        <Fact label="Population">
          <Link
            href={`${regionHref}?tab=demographics&sub=demographics`}
            scroll={false}
            className={FACT_LINK}
          >
            {population}
          </Link>
        </Fact>
        <Fact label="GDP">
          <Link href={`${regionHref}?tab=economy&sub=sectors`} scroll={false} className={FACT_LINK}>
            {gdp}
          </Link>
        </Fact>
        <Fact label={districts.label}>
          <Link
            href={`${regionHref}?tab=politics&sub=officials`}
            scroll={false}
            className={FACT_LINK}
          >
            {districts.count}
          </Link>
        </Fact>
        {leans && (
          <Fact label="Lean">
            <Tooltip
              content={
                <span className="text-body-sm tabular-nums">
                  {`Economic ${formatLeanValue(leans.economicLean)}, social ${formatLeanValue(leans.socialLean)}`}
                </span>
              }
            >
              <Link
                href={`${regionHref}?tab=demographics&sub=demographics`}
                scroll={false}
                className={FACT_LINK}
              >
                <span
                  style={{ color: positionBucketHex(leans.economicLean, "economic", european) }}
                >
                  {getLeanLabel(leans.economicLean)}
                </span>
                <span className="font-normal text-muted">, </span>
                <span style={{ color: positionBucketHex(leans.socialLean, "social") }}>
                  {getSocialLeanLabel(leans.socialLean)}
                </span>
              </Link>
            </Tooltip>
          </Fact>
        )}
        <Fact label="Government approval">
          {approval ? (
            <span
              className={`text-body-lg font-semibold tabular-nums ${
                approval.value >= 50
                  ? "text-success"
                  : approval.value >= 40
                    ? "text-warning"
                    : "text-error"
              }`}
            >
              <ApprovalTooltip
                approval={approval.value}
                baseApproval={approval.base}
                modifiers={approval.modifiers}
                href={approval.href}
              />
            </span>
          ) : (
            <span className="text-body-lg text-muted">No data</span>
          )}
        </Fact>
        <Fact label={executiveLabel} wide>
          {executive && executiveName && holderHref ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar
                url={executive.avatarUrl}
                name={executiveName}
                size="h-6 w-6"
                borderKey={executive.borderKey}
                tintColor={executive.tintColor}
              />
              <Link
                href={holderHref}
                className="truncate text-body-lg font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {executiveName}
              </Link>
              {executive.partyAbbreviation && (
                <span
                  className="flex shrink-0 items-center gap-1 text-body-sm font-medium"
                  style={{ color: executive.partyColor ?? undefined }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: executive.partyColor ?? "var(--muted)" }}
                    aria-hidden
                  />
                  {executive.partyAbbreviation}
                </span>
              )}
              {officeHref && (
                <Link
                  href={officeHref}
                  className="shrink-0 text-body-sm font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
                >
                  Office
                </Link>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-body-lg text-muted">Vacant</span>
              {officeHref && (
                <Link
                  href={officeHref}
                  className="text-body-sm font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
                >
                  Office
                </Link>
              )}
            </span>
          )}
        </Fact>
        {comprising && comprising.length > 0 && (
          <div className="col-span-2 min-w-0">
            <dt className="text-body-sm text-muted">Comprising</dt>
            <dd className="mt-0.5 text-body text-muted" title={comprising.join(", ")}>
              {comprising.join(", ")}
            </dd>
          </div>
        )}
      </dl>
    </header>
  );
}
