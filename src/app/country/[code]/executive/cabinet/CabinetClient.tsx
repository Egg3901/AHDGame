"use client";

import type { ReactNode } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import PresidentialCabinetClient from "./PresidentialCabinetClient";
import ParliamentaryCabinetClient from "./ParliamentaryCabinetClient";
import CabinetPlaceholder from "./CabinetPlaceholder";
import {
  PARLIAMENTARY_CABINET_CONFIGS,
  isParliamentaryCabinetCountry,
} from "./parliamentaryCabinetConfig";

interface Props {
  countryId: CountryId;
}

/**
 * Countries that use the presidential cabinet flow (President nominates →
 * Senate confirms), served by the country-parameterized PresidentialCabinetClient.
 * Keyed by country to satisfy the no-country-literals lint rule. Other countries
 * either share the parliamentary client or fall through to the placeholder.
 */
const CUSTOM_CABINET_RENDERERS: Partial<Record<CountryId, () => ReactNode>> = {
  US: () => <PresidentialCabinetClient countryId="US" />,
  NG: () => <PresidentialCabinetClient countryId="NG" />,
};

export default function CabinetClient({ countryId }: Props) {
  const customRenderer = CUSTOM_CABINET_RENDERERS[countryId];
  if (customRenderer) return customRenderer();

  if (isParliamentaryCabinetCountry(countryId)) {
    return <ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS[countryId]} />;
  }

  const config = COUNTRY_CONFIGS[countryId];
  return <CabinetPlaceholder countryId={countryId} countryName={config.name} />;
}
