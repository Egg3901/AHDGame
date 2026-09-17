import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types/indexFund";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";

/**
 * Shareholder display context: CEO + every named holder class (#587).
 *
 * Characters, imperial characters, holding corporations, NPPs, and index
 * funds each resolve through their own lookup so the shareholder tab can
 * name every row.
 */
export async function loadShareholderContext(db: Db, corporation: Corporation) {
  const shareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.characterId)
    .filter((id): id is ObjectId => id !== undefined);
  const imperialShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.imperialCharacterId)
    .filter((id): id is ObjectId => id !== undefined);
  const corporationShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.corporationId)
    .filter((id): id is ObjectId => id !== undefined);
  const nppShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.nppId)
    .filter((id): id is ObjectId => id !== undefined);
  const fundShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.fundId)
    .filter((id): id is ObjectId => id !== undefined);

  const isImperialCeo = corporation.ceoType === "imperial";
  const isNppCeo = corporation.ceoType === "npp";
  const ceoPromise = isImperialCeo
    ? db.collection("imperialCharacters").findOne(
        { _id: corporation.ceoId },
        {
          projection: {
            name: 1,
            avatarUrl: 1,
            sequentialId: 1,
            userId: 1,
            homeState: 1,
            countryId: 1,
          },
        }
      )
    : isNppCeo
      ? db.collection("npps").findOne(
          { _id: corporation.ceoId },
          {
            projection: {
              name: 1,
              avatarUrl: 1,
              sequentialId: 1,
              homeState: 1,
              countryId: 1,
            },
          }
        )
      : db.collection<Character>("characters").findOne(
          { _id: corporation.ceoId },
          {
            projection: {
              name: 1,
              avatarUrl: 1,
              sequentialId: 1,
              userId: 1,
              homeState: 1,
              countryId: 1,
            },
          }
        );

  const [
    ceo,
    shareholderChars,
    imperialShareholderChars,
    corporationShareholderCorps,
    nppShareholderDocs,
    fundShareholderDocs,
  ] = await Promise.all([
    ceoPromise,
    shareholderIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: shareholderIds } },
            {
              projection: {
                _id: 1,
                name: 1,
                sequentialId: 1,
                avatarUrl: 1,
                userId: 1,
                homeState: 1,
                countryId: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([] as Character[]),
    imperialShareholderIds.length > 0
      ? db
          .collection("imperialCharacters")
          .find(
            { _id: { $in: imperialShareholderIds } },
            {
              projection: {
                _id: 1,
                name: 1,
                sequentialId: 1,
                avatarUrl: 1,
                userId: 1,
                homeState: 1,
                countryId: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    corporationShareholderIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: corporationShareholderIds } },
            { projection: { _id: 1, name: 1, sequentialId: 1, logoUrl: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Corporation[]),
    nppShareholderIds.length > 0
      ? db
          .collection<{ _id: ObjectId; name: string }>("npps")
          .find({ _id: { $in: nppShareholderIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as { _id: ObjectId; name: string }[]),
    fundShareholderIds.length > 0
      ? db
          .collection<Pick<IndexFund, "_id" | "name" | "slug" | "scope" | "countryId">>(
            "indexFunds"
          )
          .find(
            { _id: { $in: fundShareholderIds } },
            { projection: { _id: 1, name: 1, slug: 1, scope: 1, countryId: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Pick<IndexFund, "_id" | "name" | "slug" | "scope" | "countryId">[]),
  ]);

  const allCorpUserIds = [
    ...(ceo?.userId ? [ceo.userId] : []),
    ...shareholderChars.filter((c) => c.userId).map((c) => c.userId),
    ...imperialShareholderChars.filter((c) => c.userId).map((c) => c.userId),
  ];
  const corpBorderMap = await fetchBordersByUserIds(db, allCorpUserIds);

  const shareholderNameMap = new Map<
    string,
    {
      name: string;
      sequentialId?: number;
      avatarUrl?: string;
      borderKey: string | null;
      tintColor: string | null;
      isImperial?: boolean;
      homeState?: string;
      countryId?: string;
    }
  >();
  for (const c of shareholderChars) {
    shareholderNameMap.set(c._id.toString(), {
      name: c.name,
      sequentialId: c.sequentialId,
      avatarUrl: c.avatarUrl,
      borderKey: c.userId ? (corpBorderMap.get(c.userId.toString())?.borderKey ?? null) : null,
      tintColor: c.userId ? (corpBorderMap.get(c.userId.toString())?.tintColor ?? null) : null,
      homeState: c.homeState,
      countryId: c.countryId,
    });
  }
  for (const ic of imperialShareholderChars) {
    shareholderNameMap.set(ic._id.toString(), {
      name: ic.name,
      sequentialId: ic.sequentialId,
      avatarUrl: ic.avatarUrl,
      borderKey: ic.userId ? (corpBorderMap.get(ic.userId.toString())?.borderKey ?? null) : null,
      tintColor: ic.userId ? (corpBorderMap.get(ic.userId.toString())?.tintColor ?? null) : null,
      isImperial: true,
      homeState: ic.homeState,
      countryId: ic.countryId,
    });
  }

  const corporationShareholderNameMap = new Map(
    corporationShareholderCorps.map((c) => [
      c._id.toString(),
      { name: c.name, sequentialId: c.sequentialId, logoUrl: c.logoUrl },
    ])
  );

  const nppShareholderNameMap = new Map<string, { name: string }>(
    nppShareholderDocs.map((n: { _id: ObjectId; name: string }) => [
      n._id.toString(),
      { name: n.name },
    ])
  );

  const fundShareholderNameMap = new Map<
    string,
    { name: string; slug: string; scope: IndexFund["scope"]; countryId?: string }
  >(
    fundShareholderDocs.map((f) => [
      f._id.toString(),
      { name: f.name, slug: f.slug, scope: f.scope, countryId: f.countryId },
    ])
  );

  return {
    isImperialCeo,
    isNppCeo,
    ceo,
    shareholderNameMap,
    corporationShareholderNameMap,
    nppShareholderNameMap,
    fundShareholderNameMap,
    corpBorderMap,
  };
}

export type ShareholderContext = Awaited<ReturnType<typeof loadShareholderContext>>;

export interface ShareholderResponse {
  characterId?: string;
  corporationId?: string;
  shares: number;
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
  logoUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  isImperial?: boolean;
  homeState?: string;
  countryId?: string;
  superShares?: number;
  isFund?: boolean;
  fundSlug?: string;
  fundScope?: IndexFund["scope"];
  fundCountryId?: string;
}

export interface ShareholderListInputs {
  corporationForControl: Corporation;
  corporation: Corporation;
  shareholderCtx: ShareholderContext;
  openListingsForInvariant: ShareListing[];
  openSellOrdersForInvariant: ShareOrder[];
  totalShares: number;
}

/**
 * Shareholder response rows, with the CEO absorbing unaccounted shares (#587).
 *
 * The share invariant reconciles listed/ordered shares against the ledger;
 * any remainder is attributed to the CEO rather than vanishing from the tab.
 */
export function buildShareholderList(inputs: ShareholderListInputs): ShareholderResponse[] {
  const {
    corporationForControl,
    corporation,
    shareholderCtx,
    openListingsForInvariant,
    openSellOrdersForInvariant,
    totalShares,
  } = inputs;
  const {
    isImperialCeo,
    ceo,
    shareholderNameMap,
    corporationShareholderNameMap,
    nppShareholderNameMap,
    fundShareholderNameMap,
    corpBorderMap,
  } = shareholderCtx;

  const existing: ShareholderResponse[] = (corporationForControl.shareholders ?? [])
    .filter(
      (sh) =>
        sh.characterId != null ||
        sh.imperialCharacterId != null ||
        sh.corporationId != null ||
        sh.nppId != null ||
        sh.fundId != null
    )
    .flatMap<ShareholderResponse>((sh) => {
      if (sh.corporationId != null) {
        const corpInfo = corporationShareholderNameMap.get(sh.corporationId.toString());
        if (!corpInfo) return [];
        return [
          {
            corporationId: sh.corporationId.toString(),
            shares: sh.shares,
            name: corpInfo.name,
            sequentialId: corpInfo.sequentialId,
            logoUrl: corpInfo.logoUrl,
          },
        ];
      }
      if (sh.nppId != null) {
        const nppInfo = nppShareholderNameMap.get(sh.nppId.toString());
        return [
          {
            characterId: sh.nppId.toString(),
            shares: sh.shares,
            name: nppInfo?.name ?? "NPP",
            isNpp: true,
          },
        ];
      }
      if (sh.fundId != null) {
        const fundInfo = fundShareholderNameMap.get(sh.fundId.toString());
        return [
          {
            characterId: sh.fundId.toString(),
            shares: sh.shares,
            name: fundInfo?.name ?? "Index Fund",
            isNpp: true,
            isFund: true,
            fundSlug: fundInfo?.slug,
            fundScope: fundInfo?.scope,
            fundCountryId: fundInfo?.countryId,
          },
        ];
      }
      const id = (sh.characterId ?? sh.imperialCharacterId)?.toString() ?? "";
      const info = shareholderNameMap.get(id);
      return [
        {
          characterId: id,
          shares: sh.shares,
          ...(sh.superShares ? { superShares: sh.superShares } : {}),
          name: info?.name ?? "Unknown",
          sequentialId: info?.sequentialId,
          avatarUrl: info?.avatarUrl,
          borderKey: info?.borderKey ?? null,
          tintColor: info?.tintColor ?? null,
          isImperial: info?.isImperial ?? false,
          homeState: info?.homeState,
          countryId: info?.countryId,
        },
      ];
    });

  const accountedShares = computeAccountedShares(
    corporation,
    openListingsForInvariant,
    openSellOrdersForInvariant
  );
  const unaccounted = totalShares - accountedShares;
  if (unaccounted > 0 && corporation.ceoId) {
    const ceoEntry = existing.find((sh) => sh.characterId === corporation.ceoId.toString());
    if (ceoEntry) {
      ceoEntry.shares += unaccounted;
    } else {
      const ceoBorder = ceo?.userId ? corpBorderMap.get(ceo.userId.toString()) : undefined;
      existing.push({
        characterId: corporation.ceoId.toString(),
        shares: unaccounted,
        name: ceo?.name ?? "Unknown",
        sequentialId: ceo?.sequentialId,
        avatarUrl: ceo?.avatarUrl,
        borderKey: ceoBorder?.borderKey ?? null,
        tintColor: ceoBorder?.tintColor ?? null,
        isImperial: isImperialCeo,
        homeState: ceo?.homeState as string | undefined,
        countryId: ceo?.countryId as string | undefined,
      });
    }
  }
  return existing;
}
