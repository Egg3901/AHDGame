"use client";

import Image from "next/image";
import { Button } from "@/components/ui";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { getEconomicPositionName, getSocialPositionName } from "@/lib/utils/politics";
import { getDisplayLean, getLeanLabel, getSocialLeanLabel } from "@/lib/utils/demographics";
import {
  ALIGNMENT_META,
  alignmentBand,
  compassDistance,
  ideologyLabel,
  type CompassPoint,
} from "@/lib/registration/alignment";
import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";
import { EDUCATION_OPTIONS, GENDER_OPTIONS, RACE_OPTIONS, labelFor } from "./creatorOptions";
import { ALLOWED_IMAGE_TYPES, type PickedImage } from "./useImagePick";

export interface CandidateFileRequirement {
  /** Stable key so React can list these without index churn. */
  key: string;
  label: string;
  met: boolean;
}

interface CandidateFileProps {
  name: string;
  countryName: string | null;
  countryFlagUrl: string | null;
  regionName: string | null;
  electorate: CompassPoint | null;
  partyName: string | null;
  /** Short form used in the tight distance rows. */
  partyAbbreviation: string | null;
  partyColor: string | null;
  /** Party sequentialId, for the logo. Null while unaffiliated. */
  partyId: string | null;
  /** Country of the chosen party, for logo resolution. */
  partyCountryId: CountryId | null;
  partyPoint: CompassPoint | null;
  position: CompassPoint;
  demographics: { race: string; gender: string; education: string; wealth: string };
  startingCapital: string | null;
  requirements: CandidateFileRequirement[];
  isSubmitting: boolean;
  /** Optional portrait and header the player chose; uploaded after creation. */
  portrait: PickedImage;
  header: PickedImage;
}

/**
 * The live candidate record. Every choice on the left writes into this panel
 * immediately, so the player sees the politician they are assembling — and the
 * policy distances that will decide their first election — before submitting.
 */
export function CandidateFile({
  name,
  countryName,
  countryFlagUrl,
  regionName,
  electorate,
  partyName,
  partyAbbreviation,
  partyColor,
  partyId,
  partyCountryId,
  partyPoint,
  position,
  demographics,
  startingCapital,
  requirements,
  isSubmitting,
  portrait,
  header,
}: CandidateFileProps) {
  const accent = partyColor ?? "var(--color-muted)";
  const outstanding = requirements.filter((r) => !r.met);

  const partyDistance = partyPoint ? compassDistance(position, partyPoint) : null;
  const electorateDistance = electorate ? compassDistance(position, electorate) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
      <div className="flex items-center justify-between gap-2 border-b border-card-border px-4 py-2">
        <span className="font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
          Candidate file
        </span>
        {countryFlagUrl && countryName && (
          <span className="relative h-4 w-6 overflow-hidden rounded-sm">
            <Image
              src={countryFlagUrl}
              alt={countryName}
              fill
              sizes="24px"
              className="object-cover"
              unoptimized={bypassNextImageOptimization(countryFlagUrl)}
            />
          </span>
        )}
      </div>

      {/* Header band, tinted by the party until a photo is chosen. `accent` is
          either a stored party hex or a CSS var, so tints go through color-mix
          rather than hex-alpha concatenation. */}
      <div
        className="relative h-20 w-full"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)` }}
      >
        {header.previewUrl ? (
          <Image
            src={header.previewUrl}
            alt=""
            aria-hidden
            fill
            sizes="21rem"
            unoptimized
            className="object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 20%, transparent) 0%, transparent 65%)`,
            }}
          />
        )}
        <ImagePickButton image={header} label="header image" className="absolute right-2 top-2" />
      </div>

      <div className="px-4 pb-3">
        {/* Portrait overlaps the header band, as on the profile page. The pick
            control sits clear of the frame so it never masks the photo. */}
        <div className="-mt-9 mb-2 flex items-end gap-2">
          <div
            className="relative z-10 h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-lg border-2 bg-card-muted shadow-card"
            style={{ borderColor: accent }}
          >
            {portrait.previewUrl ? (
              <Image
                src={portrait.previewUrl}
                alt=""
                fill
                sizes="72px"
                unoptimized
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center font-serif text-heading text-muted/70">
                {name.trim().charAt(0).toUpperCase() || "?"}
              </span>
            )}
          </div>
          <ImagePickButton image={portrait} label="portrait" className="relative z-10 mb-1" />
        </div>

        {(portrait.error || header.error) && (
          <p role="alert" className="mb-1.5 text-body-xs text-error">
            {portrait.error ?? header.error}
          </p>
        )}

        <p
          className={`font-serif text-heading leading-tight ${
            name ? "text-foreground" : "text-muted/60 italic"
          }`}
        >
          {name || "Unnamed candidate"}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body-sm text-muted">
          {partyName ? (
            // Logo and name share one flex item so the logo never orphans onto
            // its own line when a long party name wraps.
            <span className="inline-flex min-w-0 items-baseline gap-1.5">
              {partyId && partyCountryId && (
                <PartyLogo
                  partyId={partyId}
                  partyColor={accent}
                  countryId={partyCountryId}
                  size="h-4 w-4"
                  className="shrink-0 self-center"
                />
              )}
              <span className="font-medium" style={{ color: accent }}>
                {partyName}
              </span>
            </span>
          ) : (
            <span className="italic">No affiliation</span>
          )}
          {regionName && (
            <>
              <span aria-hidden>·</span>
              <span>{regionName}</span>
            </>
          )}
        </p>
      </div>

      <dl className="divide-y divide-card-border/60 border-y border-card-border/60">
        <FileRow label="Ideology">{ideologyLabel(position)}</FileRow>
        <FileRow label="Economic">
          {getEconomicPositionName(position.economic)}{" "}
          <span className="text-muted">({signed(position.economic)})</span>
        </FileRow>
        <FileRow label="Social">
          {getSocialPositionName(position.social)}{" "}
          <span className="text-muted">({signed(position.social)})</span>
        </FileRow>
        <FileRow label="Background">
          {demographics.race || demographics.gender || demographics.education
            ? [
                labelFor(GENDER_OPTIONS, demographics.gender),
                labelFor(RACE_OPTIONS, demographics.race),
                labelFor(EDUCATION_OPTIONS, demographics.education),
              ]
                .filter((v) => v !== "—")
                .join(" · ")
            : "—"}
        </FileRow>
        <FileRow label="Starting capital">{startingCapital ?? "—"}</FileRow>
      </dl>

      {(partyDistance != null || electorateDistance != null) && (
        <div className="space-y-1.5 border-b border-card-border/60 px-4 py-3">
          {partyDistance != null && partyName && (
            <VerdictLine
              label={`Distance to ${partyAbbreviation ?? partyName}`}
              distance={partyDistance}
              detail="Primaries punish candidates who run against their own platform."
            />
          )}
          {electorateDistance != null && regionName && (
            <VerdictLine
              label={`Distance to ${regionName} voters`}
              distance={electorateDistance}
              detail={
                electorate
                  ? // The headline word uses getDisplayLean (dominant axis), not the raw
                    // economic value: some era models (e.g. UK 1953) keep economicLean
                    // negative and socialLean positive in EVERY region by construction —
                    // only the social axis's magnitude flips which one dominates region to
                    // region. Rendering raw economic alone made every electorate read
                    // identically "Center-Left" here regardless of true lean; see
                    // HomeStatePicker.tsx / HomeStatePicker.test.tsx for the same fix.
                    `That electorate sits ${getLeanLabel(
                      getDisplayLean(electorate.economic, electorate.social)
                    )} / ${getSocialLeanLabel(electorate.social)}.`
                  : undefined
              }
            />
          )}
        </div>
      )}

      <div className="px-4 py-3">
        {outstanding.length > 0 ? (
          <ul className="mb-3 space-y-1">
            {outstanding.map((r) => (
              <li key={r.key} className="flex items-center gap-2 text-body-sm text-muted">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted"
                />
                {r.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-body-sm text-success">File complete.</p>
        )}

        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          disabled={outstanding.length > 0}
          className="w-full"
        >
          {isSubmitting ? "Filing…" : "Enter the arena"}
        </Button>
      </div>
    </div>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Small camera affordance over the header / portrait. Both images are optional;
 * they upload after the character exists and can also be set later from the
 * profile page.
 */
function ImagePickButton({
  image,
  label,
  className = "",
}: {
  image: PickedImage;
  label: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      <label
        className="flex h-6 cursor-pointer items-center gap-1 rounded border border-card-border bg-background/90 px-1.5 text-body-xs text-muted transition-colors hover:border-primary/50 hover:text-foreground"
        title={`Add a ${label} (optional)`}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          />
          <circle cx="12" cy="13" r="3" />
        </svg>
        <span className="sr-only">{`Add a ${label}`}</span>
        <input
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => image.pick(e.target.files?.[0] ?? null)}
        />
      </label>
      {image.previewUrl && (
        <button
          type="button"
          onClick={image.clear}
          title={`Remove ${label}`}
          className="flex h-6 w-6 items-center justify-center rounded border border-card-border bg-background/90 text-body-xs text-muted transition-colors hover:border-error/50 hover:text-error"
        >
          <span aria-hidden>×</span>
          <span className="sr-only">{`Remove ${label}`}</span>
        </button>
      )}
    </span>
  );
}

function FileRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-1.5">
      <dt className="shrink-0 font-mono text-body-xs uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-body-sm">{children}</dd>
    </div>
  );
}

function VerdictLine({
  label,
  distance,
  detail,
}: {
  label: string;
  distance: number;
  detail?: string;
}) {
  const meta = ALIGNMENT_META[alignmentBand(distance)];
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-body-sm text-muted">{label}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-body-xs font-semibold ${meta.toneClass}`}
        >
          {meta.label} {distance.toFixed(1)}
        </span>
      </div>
      {detail && <p className="mt-0.5 text-body-xs leading-snug text-muted/70">{detail}</p>}
    </div>
  );
}
