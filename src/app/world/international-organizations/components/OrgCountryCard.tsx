"use client";

import Link from "next/link";
import { type CountryId } from "@/lib/constants/countries";
import type { OrgSummary } from "../orgTypes";
import { orgHref } from "../orgRouting";
import { Seal } from "./OrgPrimitives";
import { useEntityName } from "../useEntityName";

/** Overlay card listing the organizations a clicked country belongs to. */
export function OrgCountryCard({
  countryId,
  orgs,
  position,
  onClose,
}: {
  countryId: CountryId;
  orgs: OrgSummary[];
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const entityName = useEntityName();
  const countryName = entityName(countryId);
  return (
    <div
      className="absolute z-20 w-60 rounded-xl border border-card-border bg-card p-3 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{countryName}</p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      {orgs.length === 0 ? (
        <p className="text-xs text-muted">{countryName} is not a member of any organization.</p>
      ) : (
        <ul className="space-y-1.5">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={orgHref(org)}
                className="card-hover flex items-center gap-2 rounded-lg border border-card-border bg-card p-2"
              >
                <Seal identity={org.identity} size={28} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {org.def.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
