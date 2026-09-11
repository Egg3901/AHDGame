"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload } from "../types";
import { Eyebrow } from "../components/BankSection";

/**
 * Every cap that can stop a player, with the rule and the numbers in it.
 *
 * Three separate tickets (1090, 1111, 1113) were the same complaint in
 * different clothes: the console printed a number, the number blocked an
 * action, and nothing on screen said how the number was arrived at. A player
 * could only learn a cap by hitting it, and when two screens disagreed there
 * was no way to tell which one was lying.
 *
 * The rows come from `explainBankCaps`, which is computed by the same module
 * that ENFORCES the caps, so the explanation cannot drift away from the rule
 * the way a hand-written help string does.
 */
export function CapsPanel({ data }: { data: ConsolePayload }) {
  const t = useTranslations("corporations.bankConsole");
  const caps = data.caps;
  if (!caps || caps.length === 0) return null;
  const currency = data.currency as CurrencyCode;

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <Eyebrow kind="reference" />
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Your limits, and where they come from
          </h3>
        </div>
        <Link
          href="/wiki/private-banking"
          className="text-xs text-accent underline underline-offset-2"
        >
          How banking works
        </Link>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {caps.map((cap) => (
          <div key={cap.key} className="rounded border border-card-border/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs uppercase tracking-widest text-muted">
                {cap.label}
                <Tooltip
                  content={t("tooltips.capFormula", {
                    formula: cap.formula,
                    inputs: cap.inputs
                      .map((input) =>
                        input.unit === "percent"
                          ? `${input.label} ${(input.value * 100).toFixed(1)}%`
                          : `${input.label} ${formatBankMoney(input.value, currency)}`
                      )
                      .join("; "),
                  })}
                  label={t("tooltips.capFormulaLabel", { label: cap.label })}
                />
              </span>
              <span className="font-mono text-sm text-foreground">
                {formatBankMoney(cap.value, currency)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted">{cap.lever}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
