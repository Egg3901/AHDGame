import { uniform } from "@/lib/seeds/reference/uniformUnionName";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { EraId } from "@/lib/seeds/presetSelector";
import {
  JP_UNION_NAMES_1953,
  JP_UNION_NAMES_1979,
  JP_UNION_NAMES_1991,
  JP_UNION_NAMES_1999,
  JP_UNION_NAMES_2007,
  JP_UNION_NAMES_MODERN,
} from "@/lib/countries/jp/data/jpUnionNames";
import {
  BAL_UNION_NAMES_MODERN,
  BAL_UNION_NAMES_1979,
} from "@/lib/countries/bal/data/balUnionNames";
import { BG_UNION_NAMES_MODERN, BG_UNION_NAMES_1979 } from "@/lib/countries/bg/data/bgUnionNames";
import {
  BLR_UNION_NAMES_MODERN,
  BLR_UNION_NAMES_1979,
} from "@/lib/countries/blr/data/blrUnionNames";
import {
  BR_UNION_NAMES_MODERN,
  BR_UNION_NAMES_1979,
  BR_UNION_NAMES_1953,
} from "@/lib/countries/br/data/brUnionNames";
import { CN_UNION_NAMES_MODERN } from "@/lib/countries/cn/data/cnUnionNames";
import {
  CS_UNION_NAMES_MODERN,
  CS_UNION_NAMES_1991,
  CS_UNION_NAMES_1979,
} from "@/lib/countries/cs/data/csUnionNames";
import { DD_UNION_NAMES_MODERN } from "@/lib/countries/dd/data/ddUnionNames";
import {
  DE_UNION_NAMES_MODERN,
  DE_UNION_NAMES_1999,
  DE_UNION_NAMES_1991,
  DE_UNION_NAMES_1979,
  DE_UNION_NAMES_1953,
} from "@/lib/countries/de/data/deUnionNames";
import { ES_UNION_NAMES_MODERN, ES_UNION_NAMES_1953 } from "@/lib/countries/es/data/esUnionNames";
import { FR_UNION_NAMES_MODERN } from "@/lib/countries/fr/data/frUnionNames";
import {
  HU_UNION_NAMES_MODERN,
  HU_UNION_NAMES_2007,
  HU_UNION_NAMES_1979,
} from "@/lib/countries/hu/data/huUnionNames";
import {
  IE_UNION_NAMES_MODERN,
  IE_UNION_NAMES_1999,
  IE_UNION_NAMES_1991,
  IE_UNION_NAMES_1979,
  IE_UNION_NAMES_1953,
} from "@/lib/countries/ie/data/ieUnionNames";
import {
  IT_UNION_NAMES_MODERN,
  IT_UNION_NAMES_2007,
  IT_UNION_NAMES_1999,
  IT_UNION_NAMES_1991,
  IT_UNION_NAMES_1979,
} from "@/lib/countries/it/data/itUnionNames";
import {
  NG_UNION_NAMES_MODERN,
  NG_UNION_NAMES_1979,
  NG_UNION_NAMES_1953,
} from "@/lib/countries/ng/data/ngUnionNames";
import { PL_UNION_NAMES_MODERN, PL_UNION_NAMES_1979 } from "@/lib/countries/pl/data/plUnionNames";
import {
  RO_UNION_NAMES_MODERN,
  RO_UNION_NAMES_1991,
  RO_UNION_NAMES_1979,
  RO_UNION_NAMES_1953,
} from "@/lib/countries/ro/data/roUnionNames";
import {
  RU_UNION_NAMES_MODERN,
  RU_UNION_NAMES_1991,
  RU_UNION_NAMES_1979,
} from "@/lib/countries/ru/data/ruUnionNames";
import {
  SE_UNION_NAMES_MODERN,
  SE_UNION_NAMES_2007,
  SE_UNION_NAMES_1991,
} from "@/lib/countries/se/data/seUnionNames";
import {
  TR_UNION_NAMES_MODERN,
  TR_UNION_NAMES_1991,
  TR_UNION_NAMES_1953,
} from "@/lib/countries/tr/data/trUnionNames";
import {
  UK_UNION_NAMES_MODERN,
  UK_UNION_NAMES_1999,
  UK_UNION_NAMES_1991,
  UK_UNION_NAMES_1979,
  UK_UNION_NAMES_1953,
} from "@/lib/countries/uk/data/ukUnionNames";
import {
  UKR_UNION_NAMES_MODERN,
  UKR_UNION_NAMES_1979,
} from "@/lib/countries/ukr/data/ukrUnionNames";
import {
  US_UNION_NAMES_MODERN,
  US_UNION_NAMES_2007,
  US_UNION_NAMES_1991,
  US_UNION_NAMES_1979,
  US_UNION_NAMES_1953,
} from "@/lib/countries/us/data/usUnionNames";
import { YU_UNION_NAMES_MODERN } from "@/lib/countries/yu/data/yuUnionNames";

/** Per-country, per-sector historical union names for a given era. */
export type UnionNameMap = Partial<Record<CountryId, Partial<Record<CorporationType, string>>>>;

/**
 * Shared modern-era names (2019/2023 family). Era-specific bundles override
 * these via spreads, so every era bundle is a complete map on its own.
 *
 * Historical-accuracy notes (audited 2026-07, refs union-name accuracy pass):
 * - IT: FENEAL-UIL is the construction/wood federation, and "Fegica" is a
 *   petrol-station operators' association, so extraction and entertainment
 *   now use FILCTEM-CGIL (energy/chemical/mining) and SLC-CGIL
 *   (communication/entertainment workers) instead.
 * - SE: Lantarbetareforbundet (farm workers) merged into Kommunal in 1997,
 *   so modern agriculture maps to Kommunal.
 * - TR: replaced invented "-Is" names with the real Turk-Is affiliates
 *   (Tez-Koop-Is commerce, Yol-Is construction, Tes-Is energy, TUMTIS
 *   transport). No era-correct dedicated tech union is attestable, so
 *   technology falls back to the generic name.
 * - RU: "Medprofzdrav" is not the union's name; the health workers' union is
 *   the Trade Union of Health Workers of Russia. Rail transport is dominated
 *   by Rosprofzhel (Russian Trade Union of Railwaymen and Transport Builders).
 * - ES media: FAPE is a journalists' professional association rather than a
 *   trade union, but it is a real, era-correct journalists' body; kept in
 *   preference to inventing a federation name.
 */
const NAMES_MODERN: UnionNameMap = {
  US: US_UNION_NAMES_MODERN,
  UK: UK_UNION_NAMES_MODERN,
  DE: DE_UNION_NAMES_MODERN,
  JP: JP_UNION_NAMES_MODERN,
  FR: FR_UNION_NAMES_MODERN,
  IE: IE_UNION_NAMES_MODERN,
  BR: BR_UNION_NAMES_MODERN,
  // Single state-supervised federation; correct for every era the game seeds
  // (founded 1925, rebuilt 1978 after the Cultural Revolution suspension).
  CN: CN_UNION_NAMES_MODERN,
  NG: NG_UNION_NAMES_MODERN,
  RU: RU_UNION_NAMES_MODERN,
  IT: IT_UNION_NAMES_MODERN,
  ES: ES_UNION_NAMES_MODERN,
  SE: SE_UNION_NAMES_MODERN,
  TR: TR_UNION_NAMES_MODERN,
  // East Germany's single SED-controlled federation (1946-1990). DD only
  // seeds in Cold-War presets; the entry is inert elsewhere.
  DD: DD_UNION_NAMES_MODERN,
  // MASZSZ, formed 2013; older eras override with MSZOSZ / SZOT below.
  HU: HU_UNION_NAMES_MODERN,
  PL: PL_UNION_NAMES_MODERN,
  RO: RO_UNION_NAMES_MODERN,
  YU: YU_UNION_NAMES_MODERN,
  BG: BG_UNION_NAMES_MODERN,
  UKR: UKR_UNION_NAMES_MODERN,
  BLR: BLR_UNION_NAMES_MODERN,
  CS: CS_UNION_NAMES_MODERN,
  // BAL is the game's composite Baltic country; the three real republics each
  // have their own confederation, so a neutral composite label is used.
  BAL: BAL_UNION_NAMES_MODERN,
};

/**
 * 2007 era. Diffs from modern:
 * - US: SAG-AFTRA (2012) and National Nurses United (2009) do not exist yet;
 *   The Newspaper Guild was only renamed NewsGuild in 2015.
 * - JP: UA Zensen dates from 2012; 2002-2012 the union was UI Zensen.
 * - SE: Unionen formed 2008 from Sif + HTF; in 2007 the white-collar
 *   industrial union was Sif.
 * - HU: MASZSZ dates from 2013; MSZOSZ was the main confederation.
 * - IT: FILCTEM-CGIL formed 2010; its predecessor FILCEM-CGIL (2006) covers
 *   chemicals/energy/mining here.
 * - UK: Unite the Union formed during 2007 (Amicus + TGWU) and is kept.
 */
const NAMES_2007: UnionNameMap = {
  ...NAMES_MODERN,
  US: US_UNION_NAMES_2007,
  JP: JP_UNION_NAMES_2007,
  SE: SE_UNION_NAMES_2007,
  HU: HU_UNION_NAMES_2007,
  IT: IT_UNION_NAMES_2007,
};

/**
 * 1999 era. Diffs from 2007:
 * - UK: Unite (2007), Prospect (2001) and Amicus (2001) do not exist; the
 *   engineering union was the AEEU (1992 merger), white-collar technical
 *   staff were in MSF, and bank staff in BIFU.
 * - DE: ver.di formed 2001; its predecessors (ÖTV, HBV, IG Medien, Deutsche
 *   Postgewerkschaft, DAG) are used. GGLF merged into IG BAU in 1996, so
 *   agriculture stays IG BAU.
 * - JP: UI Zensen formed 2002; Zensen Dōmei is the pre-merger federation.
 * - IE: INMO name dates from 2010 (Irish Nurses Organisation before),
 *   Financial Services Union from 2017 (IBOA before), Connect from 2017
 *   (TEEU, formed 1992, before).
 * - IT: FILCEM formed 2006; FILCEA-CGIL (chemicals) precedes it.
 */
const NAMES_1999: UnionNameMap = {
  ...NAMES_2007,
  UK: UK_UNION_NAMES_1999,
  DE: DE_UNION_NAMES_1999,
  JP: JP_UNION_NAMES_1999,
  IE: IE_UNION_NAMES_1999,
  IT: IT_UNION_NAMES_1999,
};

/**
 * 1991 era. Diffs from 1999:
 * - US: the union was formally the United Steelworkers of America; OCAW
 *   (merged away 1999) covers chemicals; IBEW stands in for technology and
 *   SAG (pre-AFTRA merger) for entertainment.
 * - UK: AEEU formed 1992, so 1991 keeps the Amalgamated Engineering Union;
 *   CWU formed 1995, so telecoms is the National Communications Union
 *   (1985-1995); COHSE only merged into UNISON in 1993.
 * - DE: IG BAU (1996), IG BCE (1997) and ver.di (2001) post-date 1991; their
 *   predecessors IG Bau-Steine-Erden, IG Bergbau und Energie, IG
 *   Chemie-Papier-Keramik, GGLF and ÖTV are used.
 * - JP: Dōmei dissolved into Rengō in 1989; Zensen Dōmei, Denki Rōren, the
 *   telecom workers' Zendentsū and the coal miners' Tanrō are era-correct.
 * - RU: the AUCCTU reorganised into the General Confederation of Trade
 *   Unions in October 1990, so a 1991 USSR world uses the successor body.
 * - Eastern bloc 1991: CNSLR (Romania, 1990; the National Trade Union Bloc
 *   only appeared mid-1991) and the Czech and Slovak Confederation of Trade
 *   Unions (ČMKOS is post-split, 1993+). KNSB (Bulgaria, 1990), FPB
 *   (Belarus, 1990), MSZOSZ (Hungary, 1990) and Solidarność are all live.
 * - SE: IF Metall (2006), Unionen (2008), Vårdförbundet (1997 name) and
 *   Finansförbundet post-date 1991; Metall, SIF and Svenska
 *   Bankmannaförbundet are used, farm workers still have
 *   Lantarbetareförbundet, and care workers are mapped to Kommunal (the
 *   dominant care-sector union of the day).
 * - IE: Mandate (1994) and TEEU-successor names post-date 1991; IDATU and
 *   IBOA are era-correct, and construction falls back to the generic name.
 * - IT: SLC-CGIL formed 1996 (FILPT before); FLAI (1988), FILT (1980),
 *   FP (1980) and FISAC (1983) already exist. No era-correct entertainment
 *   federation is attestable, so it falls back to the generic name.
 */
const NAMES_1991: UnionNameMap = {
  ...NAMES_1999,
  US: US_UNION_NAMES_1991,
  UK: UK_UNION_NAMES_1991,
  DE: DE_UNION_NAMES_1991,
  JP: JP_UNION_NAMES_1991,
  RU: RU_UNION_NAMES_1991,
  RO: RO_UNION_NAMES_1991,
  CS: CS_UNION_NAMES_1991,
  SE: SE_UNION_NAMES_1991,
  IE: IE_UNION_NAMES_1991,
  IT: IT_UNION_NAMES_1991,
  TR: TR_UNION_NAMES_1991,
};

/**
 * 1979 era. Diffs from 1991:
 * - US: UFCW only formed mid-1979; the Retail Clerks International
 *   Association is the pre-merger union.
 * - UK: AEU was the AUEW 1971-1986; GMB was the General and Municipal
 *   Workers' Union; MSF (1988) was ASTMS; CWU-lineage telecoms was the
 *   Union of Post Office Workers; BIFU was still NUBE at the start of 1979;
 *   farm workers were the NUAAW (renamed from NUAW in 1968); BECTU (1991)
 *   was the ACTT.
 * - DE: IG Medien formed 1989; printing/media was IG Druck und Papier and
 *   white-collar entertainment maps to DAG.
 * - JP: Rengō formed 1989, so the peak body is Sōhyō. Sectorals founded by
 *   1979 (JAW 1972, Zensen Dōmei, Denki Rōren 1953, Zendentsū 1950, Tanrō
 *   1950, Iroren 1957, seamen 1945) are kept; no defensible-era aviation or
 *   entertainment union is attestable, so those fall back to generic names.
 * - USSR/Eastern bloc: AUCCTU (VTsSPS) for the USSR and its republics
 *   (Belarus, the Baltic composite); Poland is the CRZZ because Solidarność
 *   was only founded in August 1980; SZOT (Hungary), UGSR (Romania), the
 *   Central Council of the Bulgarian Trade Unions, and ROH (Czechoslovakia).
 * - BR: CUT formed 1983; the corporatist confederations CNTI (industry,
 *   1946), CNTC (commerce, 1946), CNTTT (land transport) and CONTAG
 *   (rural workers, 1963) are era-correct.
 * - IE: SIPTU formed 1990; the ITGWU is the era's general union, IDATU
 *   (renamed from IUDWC in 1972) covers retail, and the Post Office
 *   Workers' Union covers telecoms.
 * - IT: FP (1980), FILT (1980), FISAC (1983) and FLAI (1988) post-date
 *   1979; Federbraccianti was the CGIL farm labourers' federation.
 * - NG: the NLC (1978) and its industrial affiliates are era-correct; the
 *   modern private-telecom staff association is not.
 */
const NAMES_1979: UnionNameMap = {
  ...NAMES_1991,
  US: US_UNION_NAMES_1979,
  UK: UK_UNION_NAMES_1979,
  DE: DE_UNION_NAMES_1979,
  JP: JP_UNION_NAMES_1979,
  RU: RU_UNION_NAMES_1979,
  PL: PL_UNION_NAMES_1979,
  HU: HU_UNION_NAMES_1979,
  RO: RO_UNION_NAMES_1979,
  BG: BG_UNION_NAMES_1979,
  CS: CS_UNION_NAMES_1979,
  // The union republics had no separate union federation of their own: the
  // AUCCTU was a single all-Union body with republican councils under it, so all
  // three report the same name rather than an invented republican confederation.
  UKR: UKR_UNION_NAMES_1979,
  BLR: BLR_UNION_NAMES_1979,
  BAL: BAL_UNION_NAMES_1979,
  BR: BR_UNION_NAMES_1979,
  IE: IE_UNION_NAMES_1979,
  IT: IT_UNION_NAMES_1979,
  NG: NG_UNION_NAMES_1979,
};

/**
 * 1953 era. Diffs from 1979:
 * - US: the AFL and CIO are still separate (they merge in 1955), so only
 *   individual internationals appear. OCAW formed 1955; the Oil Workers
 *   International Union precedes it. The American Newspaper Guild only took
 *   the shorter name in 1971. The Retail Clerks were the RCIA (renamed from
 *   the Protective Association in 1947). The IAM added "Aerospace" in 1964.
 * - UK: COHSE (1946) replaces the regulator-not-a-union "CPSM"; NUDAW merged
 *   into USDAW in 1947; the AEU predates the AUEW; ACTT was still the
 *   Association of Cine-Technicians until 1956; power workers were the ETU.
 * - DE: IG Bergbau only added "und Energie" in 1960; ÖTV, HBV, DAG, GGLF and
 *   GdED carry their full founding names.
 * - JP: blanket Sōhyō (founded 1950) with the handful of sectorals already
 *   alive in 1953: Zenji (the all-Japan auto workers' union, 1947-1954),
 *   Zendentsū (1950), Tanrō (1950) and the seamen's union (1945).
 * - RO: the CGM only became the UGSR in 1966.
 * - NG: colonial-era Nigeria's labour centre of 1953 is the All-Nigeria
 *   Trade Union Federation (formed during 1953).
 * - TR: Türk-İş (1952) plus the few affiliates already founded (Petrol-İş
 *   1950, TÜMTİS 1949, Genel Maden-İş 1946).
 * - ES: under Franco free trade unions are banned; the only legal body is
 *   the state's Organización Sindical Española (the vertical syndicate).
 * - BR: only the corporatist CNTI/CNTC are defensible; rural unionisation
 *   is pre-legalisation, so agriculture falls back to the generic name.
 * - IE: IDATU was still the Irish Union of Distributive Workers and Clerks.
 */
const NAMES_1953: UnionNameMap = {
  ...NAMES_1979,
  US: US_UNION_NAMES_1953,
  UK: UK_UNION_NAMES_1953,
  DE: DE_UNION_NAMES_1953,
  JP: JP_UNION_NAMES_1953,
  RO: RO_UNION_NAMES_1953,
  NG: NG_UNION_NAMES_1953,
  TR: TR_UNION_NAMES_1953,
  ES: ES_UNION_NAMES_1953,
  BR: BR_UNION_NAMES_1953,
  IE: IE_UNION_NAMES_1953,
};

/** Era-keyed historical union names. Later eras inherit via lookup fallback rules in `getUnionName`. */
export const UNION_NAMES_BY_ERA: Partial<Record<EraId, UnionNameMap>> = {
  "1953": NAMES_1953,
  "1979": NAMES_1979,
  "1991": NAMES_1991,
  "1999": NAMES_1999,
  "2007": NAMES_2007,
  "2019": NAMES_MODERN,
  "2023": NAMES_MODERN,
  "2027": NAMES_MODERN,
};
