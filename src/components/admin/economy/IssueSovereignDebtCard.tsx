"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";

interface IssueResult {
  success: boolean;
  message: string;
  result?: {
    bondId: string;
    countryId: CountryId;
    issueAmount: number;
    couponRate: number;
    newPrincipal: number;
    newDebtInterest: number;
    newSurplus: number;
  };
}

export function IssueSovereignDebtCard() {
  const registered = useRegisteredCountries();
  const [countryId, setCountryId] = useState<CountryId>("US");
  const [maturityTurns, setMaturityTurns] = useState<48 | 96 | 240>(48);
  const [customFaceValue, setCustomFaceValue] = useState("");
  const [useQuarterDeficit, setUseQuarterDeficit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);

  const submit = async () => {
    setLoading(true);
    setResult(null);

    try {
      const parsedFaceValue = customFaceValue.trim()
        ? Number.parseInt(customFaceValue.replace(/,/g, ""), 10)
        : undefined;

      const response = await fetch("/api/admin/bonds/issue-sovereign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryId,
          maturityTurns,
          useQuarterDeficit,
          ...(parsedFaceValue ? { faceValue: parsedFaceValue } : {}),
        }),
      });

      const json = await response.json();
      setResult({
        success: response.ok && json.success,
        message: json.message ?? json.error ?? "Unknown response",
        result: json.result,
      });
    } catch {
      setResult({ success: false, message: "Network error - could not issue sovereign debt." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Issue Sovereign Debt (Test)</h3>
        <p className="mt-1 text-xs text-muted">
          Admin-only route for manually issuing a sovereign bond series. By default it issues one
          quarter of the current annual deficit and updates national debt immediately.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="country-id">Country</Label>
          <select
            id="country-id"
            value={countryId}
            onChange={(event) => setCountryId(event.target.value as CountryId)}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {registered.map((id) => (
              <option key={id} value={id}>
                {COUNTRY_CONFIGS[id].name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="maturity-turns">Maturity</Label>
          <select
            id="maturity-turns"
            value={maturityTurns}
            onChange={(event) => setMaturityTurns(Number(event.target.value) as 48 | 96 | 240)}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value={48}>1 Year</option>
            <option value={96}>2 Years</option>
            <option value={240}>5 Years</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="custom-face-value">Custom Face Value (optional)</Label>
          <Input
            id="custom-face-value"
            value={customFaceValue}
            onChange={(event) => setCustomFaceValue(event.target.value)}
            placeholder="125000000000"
            inputMode="numeric"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={useQuarterDeficit}
          onChange={(event) => setUseQuarterDeficit(event.target.checked)}
          className="h-4 w-4 rounded border-card-border accent-primary"
        />
        Use quarter of current annual deficit when custom face value is blank
      </label>

      <Button variant="primary" onClick={submit} isLoading={loading}>
        Issue Sovereign Debt
      </Button>

      {result ? (
        <div
          className={`rounded-lg border p-4 text-sm ${
            result.success
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <p className="font-medium">{result.message}</p>
          {result.result ? (
            <div className="mt-2 space-y-1 text-xs text-foreground">
              <p>Bond ID: {result.result.bondId}</p>
              <p>Issue Amount: {result.result.issueAmount.toLocaleString("en-US")}</p>
              <p>Coupon Rate: {result.result.couponRate.toFixed(2)}%</p>
              <p>New Debt Principal: {result.result.newPrincipal.toLocaleString("en-US")}</p>
              <p>Annual Debt Interest: {result.result.newDebtInterest.toLocaleString("en-US")}</p>
              <p>Budget Balance: {result.result.newSurplus.toLocaleString("en-US")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
