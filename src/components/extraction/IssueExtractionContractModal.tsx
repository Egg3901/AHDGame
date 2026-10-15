"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { useTranslations } from "next-intl";
import {
  PublishTenderForm,
  type ContractAccess,
} from "@/components/governmentContracts/ContractForms";
interface Props {
  level: "national" | "state";
  countryId: string;
  stateId?: string;
  stateOptions?: { id: string; name: string }[];
  onClose: () => void;
  onIssued: () => void;
}
export function IssueExtractionContractModal({ countryId, stateId, onClose, onIssued }: Props) {
  const t = useTranslations("corporations.governmentContracts");
  const router = useRouter();
  const [access, setAccess] = useState<ContractAccess | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/country/${countryId}/government-contracts/access`, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setAccess)
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [countryId]);
  return (
    <Modal open scrollable maxWidthClass="max-w-3xl" title={t("publish")} onClose={onClose}>
      {error ? (
        <p role="alert">{t("loadFailed")}</p>
      ) : access ? (
        <PublishTenderForm
          countryId={countryId}
          access={
            stateId
              ? { ...access, states: access.states.filter((s) => s.stateId === stateId) }
              : access
          }
          initialType="extraction"
          onDone={() => {
            onIssued();
            onClose();
            router.push(
              "/country/" +
                countryId.toLowerCase() +
                "/government-contracts?tab=active&type=extraction&page=1"
            );
          }}
        />
      ) : (
        <p>{t("loading")}</p>
      )}
    </Modal>
  );
}
