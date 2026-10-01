/** Read-only 1991 reset metric coverage report. */
import {
  auditOpeningNationalMetricSources1991,
  auditOpeningMetricSources,
  openingNationalFiscalObservations1991,
} from "../../src/lib/resetMetrics/openingSeed1991";

export { auditOpeningMetricSources, auditOpeningNationalMetricSources1991 };

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/auditOpeningMetrics.ts")) {
  const rows = auditOpeningMetricSources();
  const byCountry = ["US", "UK", "JP"].map((country) => {
    const countryRows = rows.filter((row) => row.country === country);
    return {
      country,
      regions: countryRows.length,
      observedOrDerivedValues: countryRows.reduce((sum, row) => sum + row.observed, 0),
      provisionalValues: countryRows.reduce((sum, row) => sum + row.provisional, 0),
      unavailableIds: [...new Set(countryRows.flatMap((row) => row.unavailable))].sort(),
    };
  });
  const nationalFiscal = openingNationalFiscalObservations1991();
  const national = auditOpeningNationalMetricSources1991();
  const nationalUnavailable = Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country) => [
      country,
      Object.values(national[country])
        .filter((observation) => observation.value === null)
        .map((observation) => observation.metricId),
    ])
  );
  const nationalProvisional = Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country) => [
      country,
      Object.values(national[country])
        .filter((observation) => observation.status === "proxy")
        .map((observation) => observation.metricId),
    ])
  );
  const nationalReadiness = Object.fromEntries(
    (["US", "UK", "JP"] as const).map((country) => [country, national[country]["57"]?.value])
  );
  console.log(
    JSON.stringify(
      {
        preset: "1991-default",
        byCountry,
        nationalFiscal,
        nationalReadiness,
        nationalProvisional,
        nationalUnavailable,
      },
      null,
      2
    )
  );
}
