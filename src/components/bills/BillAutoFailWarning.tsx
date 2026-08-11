"use client";

import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

function formatWarningDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function getBillAutoFailWarningConfirmText(warning: BillProposalAutoFailWarning): string {
  return [
    `Warning: The next ${warning.electionName} is expected to finalize on ${formatWarningDate(warning.electionEndsAt)}.`,
    `Bills still in the ${warning.lowerChamberName} at that time automatically fail.`,
    `This proposal would likely be in the ${warning.lowerChamberName} from ${formatWarningDate(warning.lowerChamberExposureStartsAt)} to ${formatWarningDate(warning.lowerChamberExposureEndsAt)}.`,
    "Propose this bill anyway?",
  ].join("\n\n");
}

type BillProposalSubmitResponse = {
  error?: string;
  autoFailWarning?: BillProposalAutoFailWarning | null;
  requiresElectionRiskConfirmation?: boolean;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJsonResponse(response: Response): Promise<BillProposalSubmitResponse> {
  const text = await response.text();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? (parsed as BillProposalSubmitResponse) : {};
  } catch {
    return {};
  }
}

export async function postBillProposalWithElectionConfirmation({
  url,
  body,
}: {
  url: string;
  body: Record<string, unknown>;
}): Promise<{
  response: Response;
  data: BillProposalSubmitResponse;
  cancelled: boolean;
}> {
  const submitAttempt = async (confirmElectionRisk: boolean) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        ...(confirmElectionRisk ? { confirmElectionRisk: true } : {}),
      }),
    });
    const data = await readJsonResponse(response);
    return { response, data };
  };

  let attempt = await submitAttempt(Boolean(body.confirmElectionRisk));
  if (
    !attempt.response.ok &&
    attempt.data.requiresElectionRiskConfirmation &&
    attempt.data.autoFailWarning
  ) {
    const confirmed = window.confirm(
      getBillAutoFailWarningConfirmText(attempt.data.autoFailWarning)
    );
    if (!confirmed) {
      return { ...attempt, cancelled: true };
    }
    attempt = await submitAttempt(true);
  }

  return { ...attempt, cancelled: false };
}

export function BillAutoFailWarningBanner({ warning }: { warning: BillProposalAutoFailWarning }) {
  return (
    <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3">
      <p className="text-sm font-semibold text-error">Election timing warning</p>
      <p className="mt-1 text-sm text-foreground">
        The next {warning.electionName} is expected to finalize on{" "}
        <span className="font-medium">{formatWarningDate(warning.electionEndsAt)}</span>. Bills
        still in the {warning.lowerChamberName} at that time automatically fail.
      </p>
      <p className="mt-1 text-xs text-muted">
        This proposal would likely be in the {warning.lowerChamberName} from{" "}
        {formatWarningDate(warning.lowerChamberExposureStartsAt)} to{" "}
        {formatWarningDate(warning.lowerChamberExposureEndsAt)}.
      </p>
    </div>
  );
}
