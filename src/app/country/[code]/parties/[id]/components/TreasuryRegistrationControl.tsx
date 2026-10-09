import { Slider } from "@/components/ui";
import { useTranslations } from "next-intl";
import { REG_DRIVE_MAX_BOOST_PER_STATE } from "@/lib/parties/registrationDrive";
import type { PartyData } from "./types";
import type { TreasuryAction } from "./treasuryReducer";
import { fmt } from "./helpers";

interface TreasuryRegistrationControlProps {
  party: PartyData;
  registrationForm: { percent: number; saving: boolean };
  dispatch: (action: TreasuryAction) => void;
  onSave: () => void;
}

// Voter Registration Drive (player suggestion #81). Mirrors TreasuryGotvControl,
// but registration is a per-party-per-state lane with no demographic dimension,
// so there is no category/group targeting — just a percent-of-revenue slider.
export function TreasuryRegistrationControl({
  party,
  registrationForm,
  dispatch,
  onSave,
}: TreasuryRegistrationControlProps) {
  const t = useTranslations("parties.registrationPresence");
  const registrationSpend = Math.floor(
    party.expectedHourlyIncome * (registrationForm.percent / 100)
  );
  const dirty = registrationForm.percent !== party.registrationBudgetPercent;

  return (
    <div className="px-6 py-5 border-b border-card-border/40">
      <div className="flex items-center gap-2 mb-1">
        <svg
          className="h-4 w-4 text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        <div className="text-xs font-semibold text-muted">Registration drive</div>
      </div>
      <p className="text-body-sm text-muted mb-3 ml-6">{t("description")}</p>

      <div className="flex items-center gap-4">
        <Slider
          min={0}
          max={25}
          value={registrationForm.percent}
          onChange={(e) =>
            dispatch({
              type: "SET_REGISTRATION",
              field: "percent",
              value: parseInt(e.target.value),
            })
          }
          variant="primary"
          className="flex-1 max-w-48"
        />
        <span className="text-lg font-bold tabular-nums w-12 text-right">
          {registrationForm.percent}%
        </span>
        {dirty && (
          <button
            onClick={onSave}
            disabled={registrationForm.saving}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {registrationForm.saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {registrationForm.percent > 0 && (
        <div className="mt-3 ml-6 rounded-lg bg-background/50 border border-card-border/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{t("allocated")}</span>
            <span className="font-semibold tabular-nums">
              {fmt(registrationSpend, party.countryId)} / hr
            </span>
          </div>
          <p className="text-body-sm text-muted pt-0.5">
            {t("limit", { cap: REG_DRIVE_MAX_BOOST_PER_STATE.toFixed(2) })}
          </p>
        </div>
      )}
    </div>
  );
}
