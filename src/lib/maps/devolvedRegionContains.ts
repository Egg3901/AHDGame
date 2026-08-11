import type { CountryId } from "@/lib/constants/countries";

/**
 * Constituent council / principal areas covered by each seceded-country map
 * region — shown in the map's region list ("covers …"), mirroring how the
 * Ireland map identifies which counties make up each NUTS3 region. Derived from
 * the Eurostat NUTS3 (2016) groupings used to build /sco-regions.json and
 * /wal-regions.json (see scripts/build-country-geojson.ts).
 */
export const DEVOLVED_REGION_CONTAINS: Partial<Record<CountryId, Record<string, string[]>>> = {
  SCO: {
    GLA: ["Glasgow City", "East & West Dunbartonshire", "Renfrewshire", "Inverclyde"],
    LOT: ["Edinburgh", "East & Mid Lothian", "West Lothian"],
    HIG: ["Highland", "Argyll & Bute", "Western Isles", "Orkney", "Shetland", "Moray"],
    GRA: ["Aberdeen City", "Aberdeenshire"],
    TAY: ["Dundee", "Angus", "Perth & Kinross", "Fife", "Stirling"],
    STH: ["Scottish Borders", "Dumfries & Galloway", "Ayrshire", "South Lanarkshire"],
    CSC: ["North Lanarkshire", "Falkirk", "Clackmannanshire"],
  },
  WAL: {
    CDF: ["Cardiff", "Vale of Glamorgan", "Monmouthshire", "Newport"],
    SWA: ["Swansea", "Carmarthenshire", "Pembrokeshire", "Bridgend", "Neath Port Talbot"],
    VAL: ["Rhondda Cynon Taf", "Merthyr Tydfil", "Caerphilly", "Blaenau Gwent", "Torfaen"],
    MWA: ["Powys", "Ceredigion"],
    NWW: ["Isle of Anglesey", "Gwynedd", "Conwy", "Denbighshire"],
    NEW: ["Flintshire", "Wrexham"],
  },
};
