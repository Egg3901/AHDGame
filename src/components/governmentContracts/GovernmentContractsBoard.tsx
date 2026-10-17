"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ContractType, TenderTab, TenderView } from "@/lib/governmentContracts/types";
import {
  PublishTenderForm,
  BidForm,
  contractPost,
  inputClass,
  buttonClass,
  type ContractAccess,
} from "./ContractForms";
import {
  contractLocalAmount,
  validContractQuote,
} from "@/lib/governmentContracts/rules/presentation";
import { apiErrorText } from "@/lib/errors/catalog";
interface Listing {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  currentTurn: number;
  tenders: Omit<TenderView, "bids" | "canManage" | "bidCount">[];
}
async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorText(data, "Government contracts could not be loaded."));
  return data as T;
}
export function GovernmentContractsBoard({
  countryId,
  countryName,
  tab = "active",
  type = "all",
  page = 1,
  embedded = false,
  focusTenderId,
  supplier = "all",
}: {
  countryId: string;
  countryName: string;
  tab?: TenderTab;
  type?: ContractType | "all";
  page?: number;
  embedded?: boolean;
  focusTenderId?: string;
  supplier?: string;
}) {
  const t = useTranslations("corporations.governmentContracts");
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null),
    [access, setAccess] = useState<ContractAccess | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [publishing, setPublishing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const base = `/country/${countryId.toLowerCase()}/government-contracts`;
  const api = `/api/country/${countryId}/government-contracts`;
  useEffect(() => {
    const controller = new AbortController();
    readJson<Listing>(
      `${api}?tab=${tab}&type=${type}&page=${page}&supplier=${supplier}`,
      controller.signal
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setListing(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [api, tab, type, page, supplier, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    readJson<ContractAccess>(`${api}/access`, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setAccess(data);
          setAccessError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAccess(null);
          setAccessError(true);
        }
      });
    return () => controller.abort();
  }, [api, refresh]);
  const href = (nextTab: TenderTab, nextType: string, nextPage: number, nextSupplier = supplier) =>
    `${base}?tab=${nextTab}&type=${nextType}&page=${nextPage}${nextSupplier !== "all" ? `&supplier=${nextSupplier}` : ""}`;
  const reload = () => {
    setRefresh((n) => n + 1);
    setPublishing(false);
  };
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{countryName}</p>
          <h1 className={embedded ? "text-xl font-bold" : "text-3xl font-bold"}>{t("heading")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {embedded && (
            <Link className="text-sm text-primary" href={href(tab, type, 1)}>
              {t("openBoard")}
            </Link>
          )}
          {access && (access.defence || access.nationalExtraction || access.regionalExtraction) && (
            <button className={buttonClass} onClick={() => setPublishing((v) => !v)}>
              {publishing ? t("closeForm") : t("publish")}
            </button>
          )}
        </div>
      </header>
      {focusTenderId && supplier === "all" && (
        <TenderDetails
          countryId={countryId}
          tenderId={focusTenderId}
          access={access}
          onChange={reload}
          showTitle
        />
      )}
      {accessError && !error && (
        <div role="alert" className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-sm text-muted">{t("actionsLoadFailed")}</p>
          <button type="button" className="mt-2 text-sm text-primary" onClick={reload}>
            {t("retry")}
          </button>
        </div>
      )}
      {publishing && access && (
        <PublishTenderForm
          countryId={countryId}
          access={access}
          initialType={type === "all" ? undefined : type}
          onDone={(publishedType) => {
            reload();
            if (!embedded || (type !== "all" && publishedType !== type))
              router.push(href("active", publishedType ?? type, 1));
          }}
        />
      )}
      <nav
        aria-label={t("tabsLabel")}
        className="grid grid-cols-2 gap-1 rounded-xl border border-card-border bg-card p-1 sm:flex sm:overflow-x-auto"
      >
        {(["active", "closed", "awarded", "canceled"] as TenderTab[]).map((key) => (
          <Link
            key={key}
            href={href(key, type, 1)}
            aria-current={tab === key ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? "bg-primary text-white" : "text-muted hover:text-foreground"}`}
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="whitespace-nowrap">{t("type")}</span>
          <select
            className="min-w-0 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => router.push(href(tab, e.target.value, 1))}
          >
            <option value="all">{t("allTypes")}</option>
            {(["defence", "extraction"] as ContractType[]).map((key) => (
              <option key={key} value={key}>
                {t(`types.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 max-w-full flex-wrap items-center gap-3 text-sm">
          <span>{t("viewerFilter")}</span>
          <select
            className={`${inputClass} min-w-0 max-w-full sm:w-auto`}
            value={supplier}
            onChange={(e) => router.push(href(tab, type, 1, e.target.value))}
          >
            <option value="all">{t("viewerAll")}</option>
            <option value="mine" disabled={!access?.corporations?.length}>
              {t("viewerMine")}
            </option>
            {access?.corporations?.map((corp) => (
              <option key={corp._id} value={corp._id}>
                {corp.name}
              </option>
            ))}
          </select>
        </label>
        {listing && <p className="text-sm text-muted">{t("results", { count: listing.total })}</p>}
      </div>
      {supplier !== "all" && <p className="text-sm text-muted">{t("viewerFilterHint")}</p>}
      {error ? (
        <div role="alert" className="rounded-xl border border-error/30 bg-card p-5">
          <p>{error}</p>
          <button className="mt-3 text-primary" onClick={reload}>
            {t("retry")}
          </button>
        </div>
      ) : !listing ? (
        <p role="status" className="p-6 text-sm text-muted">
          {t("loading")}
        </p>
      ) : !listing.tenders.length ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <h2 className="font-semibold">{t(`empty.${tab}`)}</h2>
          <p className="mt-2 text-sm text-muted">
            {page > listing.totalPages ? t("pageOutOfRange") : t("emptyHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {listing.tenders
            .filter((row) => supplier !== "all" || row._id !== focusTenderId)
            .map((row) => (
              <article key={row._id} className="rounded-xl border border-card-border bg-card p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t(`types.${row.terms.type}`)}
                    </span>
                    <h2 className="mt-1 text-lg font-semibold">{row.title}</h2>
                  </div>
                  <span className="self-start rounded-full border border-card-border px-3 py-1 text-xs">
                    {t(`tabs.${row.tab}`)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{row.description}</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">{t("closesTurn")}</dt>
                    <dd>{row.closesTurn}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("awardDeadline")}</dt>
                    <dd>{row.awardDeadlineTurn}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("scope")}</dt>
                    <dd>
                      {row.terms.type === "defence"
                        ? t("defenceSummary", {
                            lots: row.terms.lots,
                            component: t(`domains.${row.terms.component}`),
                            grade: row.terms.grade,
                          })
                        : t("extractionSummary", {
                            state: row.terms.stateId,
                            resource: row.terms.resource,
                            share: row.terms.share * 100,
                          })}
                    </dd>
                  </div>
                </dl>
                {row.terms.type === "extraction" && <ExtractionScope row={row} />}
                {row.awardReason && (
                  <p className="mt-3 text-sm">
                    {t("awardReason")}: {row.awardReason}
                  </p>
                )}
                {row.cancellationReason && (
                  <p className="mt-3 text-sm text-muted">{row.cancellationReason}</p>
                )}
                <button
                  className="mt-4 text-sm font-semibold text-primary"
                  aria-expanded={selected === row._id}
                  onClick={() => setSelected(selected === row._id ? null : row._id)}
                >
                  {selected === row._id ? t("hideDetails") : t("viewDetails")}
                </button>
                {selected === row._id && (
                  <TenderDetails
                    countryId={countryId}
                    tenderId={row._id}
                    access={access}
                    onChange={reload}
                  />
                )}
              </article>
            ))}
        </div>
      )}
      {listing && (
        <nav
          aria-label={t("paginationLabel")}
          className="flex items-center justify-between gap-3 border-t border-card-border pt-4"
        >
          {page > 1 ? (
            <Link className="text-sm text-primary" href={href(tab, type, page - 1)}>
              {t("previous")}
            </Link>
          ) : (
            <span className="text-sm text-muted">{t("previous")}</span>
          )}
          <span className="text-sm text-muted">
            {t("page", { page, total: listing.totalPages })}
          </span>
          {page < listing.totalPages ? (
            <Link className="text-sm text-primary" href={href(tab, type, page + 1)}>
              {t("next")}
            </Link>
          ) : (
            <span className="text-sm text-muted">{t("next")}</span>
          )}
        </nav>
      )}
    </section>
  );
}
function extractionMoney(amount: number, row: TenderView): string | null {
  return validContractQuote(row.currencyQuote)
    ? `${contractLocalAmount(amount, row.currencyQuote).toLocaleString(undefined, { maximumSignificantDigits: 12 })} ${row.currencyQuote.code}`
    : null;
}
function ExtractionScope({ row }: { row: Pick<TenderView, "terms" | "capacityQuote"> }) {
  const t = useTranslations("corporations.governmentContracts");
  if (row.terms.type !== "extraction") return null;
  return (
    <div className="mt-3 space-y-2 text-sm text-muted">
      <p>
        {row.capacityQuote
          ? t("capacityQuantity", {
              allocated: row.capacityQuote.allocatedDailyUnits,
              total: row.capacityQuote.totalDailyUnits,
              resource: row.terms.resource,
            })
          : t("capacityUnavailable")}
      </p>
      <p>{t("capacityBasis")}</p>
    </div>
  );
}
function TenderDetails({
  countryId,
  tenderId,
  access,
  onChange,
  showTitle = false,
}: {
  countryId: string;
  tenderId: string;
  access: ContractAccess | null;
  onChange: () => void;
  showTitle?: boolean;
}) {
  const t = useTranslations("corporations.governmentContracts");
  const [detail, setDetail] = useState<{ tender: TenderView; currentTurn: number } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(""),
    [reason, setReason] = useState("");
  const [acknowledgeConflict, setAcknowledgeConflict] = useState(false);
  const api = `/api/country/${countryId}/government-contracts/${tenderId}`;
  useEffect(() => {
    const c = new AbortController();
    readJson<{ tender: TenderView; currentTurn: number }>(api, c.signal)
      .then((data) => {
        if (!c.signal.aborted) {
          setDetail(data);
          setAcknowledgeConflict(false);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [api, version]);
  const reload = () => {
    setVersion((v) => v + 1);
    onChange();
  };
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await contractPost(`${api}/${path}`, body);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }
  if (!detail)
    return (
      <div className="mt-4" role={error ? "alert" : "status"}>
        {error || t("loading")}
        {error && (
          <button type="button" className="ml-3 text-primary" onClick={reload}>
            {t("retry")}
          </button>
        )}
      </div>
    );
  const row = detail.tender,
    terms = row.terms;
  const warning = row.awardWarnings?.[row.winningCorporationId || selected];
  return (
    <div className="mt-4 space-y-4 border-t border-card-border pt-4">
      {showTitle && (
        <h2 className="text-lg font-semibold">
          {row.title} <span className="text-sm text-muted">({t(`tabs.${row.tab}`)})</span>
        </h2>
      )}
      {terms.type === "defence" ? (
        <p className="text-sm">
          {t("defenceTerms", { amount: terms.maximumPricePerLot, country: countryId })}
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="font-semibold">{t("extractionPayment")}</p>
          {showTitle && (
            <>
              <p>
                {t("extractionSummary", {
                  state: terms.stateId,
                  resource: terms.resource,
                  share: terms.share * 100,
                })}
              </p>
              <ExtractionScope row={row} />
            </>
          )}
          <p>
            {t("extractionTermsLocal", {
              fee: extractionMoney(terms.minimumSigningFeeAnchor, row) ?? t("currencyUnavailable"),
              royalty: terms.royaltyRatePerTurn * 100,
              term: terms.termTurns,
            })}
          </p>
          <p className="text-muted">{t("royaltyBasis")}</p>
          <p className="text-muted">{t("extractionAfterAward")}</p>
          <p className="text-muted">{t("exchangeNote")}</p>
        </div>
      )}
      {row.tab === "active" && <p className="text-sm text-muted">{t("sealed")}</p>}
      <h3 className="font-semibold">{row.tab === "active" ? t("yourBid") : t("submittedBids")}</h3>
      {row.bids.length === 0 ? (
        <p className="text-sm text-muted">{t("noBids")}</p>
      ) : (
        <ul className="divide-y divide-card-border">
          {row.bids.map((b) => (
            <li
              key={b.corporationId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span>
                {b.corporationName}
                {b.withdrawn && <span className="ml-2 text-xs text-muted">{t("withdrawn")}</span>}
              </span>
              <span className="text-sm">
                {terms.type === "defence"
                  ? `${b.amount.toLocaleString()} ${t("localPerLot", { country: countryId })}`
                  : (extractionMoney(b.amount, row) ?? t("currencyUnavailable"))}
              </span>
              {row.canManage && row.tab === "closed" && !b.withdrawn && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="radio"
                    name={`winner-${row._id}`}
                    value={b.corporationId}
                    checked={(row.winningCorporationId || selected) === b.corporationId}
                    disabled={row.status === "awarding"}
                    onChange={() => {
                      setSelected(b.corporationId);
                      setAcknowledgeConflict(false);
                    }}
                  />
                  {t("selectBid")}
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {!!row.bidHistory?.length && (
        <details className="rounded-lg border border-card-border p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t("bidHistory")}</summary>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {row.bidHistory.map((b) => (
              <li key={b.corporationId + ":" + b.revision}>
                {t("historyEntry", {
                  corporation: b.corporationName,
                  revision: b.revision,
                  turn: b.submittedTurn,
                  amount:
                    terms.type === "extraction"
                      ? (extractionMoney(b.amount, row) ?? t("currencyUnavailable"))
                      : `${b.amount.toLocaleString()} ${t("localPerLot", { country: countryId })}`,
                  status: b.withdrawn ? t("withdrawn") : t("recordedBid"),
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
      {row.tab === "active" && access && (
        <BidForm key={version} countryId={countryId} tender={row} access={access} onDone={reload} />
      )}
      {row.canManage && (row.tab === "active" || row.tab === "closed") && (
        <div className="space-y-3 rounded-lg border border-card-border p-4">
          <label className="block text-sm">
            {t("publicReason")}
            <textarea
              className={inputClass}
              value={row.status === "awarding" ? row.awardReason : reason}
              disabled={row.status === "awarding"}
              onChange={(e) => setReason(e.target.value)}
              minLength={10}
              maxLength={1000}
            />
          </label>
          {warning && row.status !== "awarding" && (
            <div role="alert" className="space-y-2 rounded-lg border border-warning p-3 text-sm">
              <p>
                {t(warning.basis === "owner" ? "ownerWarning" : "stakeWarning", {
                  stake: warning.stakeShare * 100,
                  penalty: warning.favorabilityPenalty,
                })}
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledgeConflict}
                  onChange={(e) => setAcknowledgeConflict(e.target.checked)}
                />
                {t("acknowledgeConflict")}
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {row.tab === "closed" && (
              <button
                disabled={
                  busy ||
                  !(row.winningCorporationId || selected) ||
                  (row.status !== "awarding" &&
                    (reason.trim().length < 10 || (!!warning && !acknowledgeConflict)))
                }
                className={buttonClass}
                onClick={() =>
                  void action("award", {
                    corporationId: row.winningCorporationId || selected,
                    reason: row.awardReason || reason,
                    acknowledgeConflict,
                  })
                }
              >
                {row.status === "awarding" ? t("resumeAward") : t("award")}
              </button>
            )}
            {row.status !== "awarding" && (
              <button
                disabled={busy || reason.trim().length < 10}
                className="text-sm text-error disabled:opacity-50"
                onClick={() => void action("cancel", { reason })}
              >
                {t("cancelTender")}
              </button>
            )}
          </div>
        </div>
      )}
      {row.tab === "awarded" && (
        <p className="text-sm">{t("contractReference", { id: row.contractId })}</p>
      )}
      {row.tab === "awarded" && row.selfDealing && (
        <p className="text-sm text-warning">
          {t("selfDealing", {
            name: row.selfDealing.ministerName ?? "",
            penalty: row.selfDealing.favorabilityPenalty,
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
          <button type="button" className="ml-3 text-primary" onClick={reload}>
            {t("retry")}
          </button>
        </p>
      )}
    </div>
  );
}
