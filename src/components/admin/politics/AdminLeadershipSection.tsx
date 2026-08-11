"use client";

import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { USLeadershipPanel } from "../leadership/USLeadershipPanel";
import { UKLeadershipPanel } from "../leadership/UKLeadershipPanel";

interface AdminLeadershipSectionProps {
  countryId: CountryId;
}

const UK_ID = COUNTRY_CONFIGS.UK.id;

export function AdminLeadershipSection({ countryId }: AdminLeadershipSectionProps) {
  if (countryId === UK_ID) return <UKLeadershipPanel />;
  return <USLeadershipPanel />;
}
