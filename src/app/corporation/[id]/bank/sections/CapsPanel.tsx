"use client";

import Link from "next/link";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload } from "../types";

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
  const caps = data.caps;
  if (!caps || caps.length === 0) return null;
  const currency = data.currency as CurrencyCode;

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Your limits, and where they come from
        </h3>
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
              <span className="text-xs uppercase tracking-widest text-muted">{cap.label}</span>
              <span className="font-mono text-sm text-foreground">
                {formatBankMoney(cap.value, currency)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted">{cap.formula}</p>
            <dl className="mt-2 space-y-0.5">
              {cap.inputs.map((input) => (
                <div key={input.label} className="flex justify-between gap-2 text-[11px]">
                  <dt className="text-muted">{input.label}</dt>
                  <dd className="font-mono text-foreground/80">
                    {input.label.toLowerCase().includes("ratio")
                      ? `${(input.value * 100).toFixed(1)}%`
                      : formatBankMoney(input.value, currency)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-muted">{cap.lever}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
