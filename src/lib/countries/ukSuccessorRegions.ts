/** Stable game regions are unions of whole council areas, not electoral constituencies.
 * ONS December 2024 LAD BSC (overview resolution), OGL v3. These are reference boundaries across game eras;
 * they do not claim to reproduce the pre-1996 local-government structure.
 * Scottish/Welsh constituency boundaries can cross councils and are not used here.
 */
export const SUCCESSOR_COUNCIL_SOURCE =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LAD_DEC_24_UK_BSC/FeatureServer/0";
export const SUCCESSOR_REGION_COUNCILS = {
  SCO: {
    GLA: [
      {
        code: "S12000049",
        name: "Glasgow City",
      },
      {
        code: "S12000045",
        name: "East Dunbartonshire",
      },
      {
        code: "S12000039",
        name: "West Dunbartonshire",
      },
      {
        code: "S12000038",
        name: "Renfrewshire",
      },
      {
        code: "S12000011",
        name: "East Renfrewshire",
      },
      {
        code: "S12000018",
        name: "Inverclyde",
      },
    ],
    LOT: [
      {
        code: "S12000036",
        name: "City of Edinburgh",
      },
      {
        code: "S12000010",
        name: "East Lothian",
      },
      {
        code: "S12000019",
        name: "Midlothian",
      },
      {
        code: "S12000040",
        name: "West Lothian",
      },
    ],
    HIG: [
      {
        code: "S12000017",
        name: "Highland",
      },
      {
        code: "S12000035",
        name: "Argyll and Bute",
      },
      {
        code: "S12000013",
        name: "Na h-Eileanan Siar",
      },
      {
        code: "S12000023",
        name: "Orkney Islands",
      },
      {
        code: "S12000027",
        name: "Shetland Islands",
      },
      {
        code: "S12000020",
        name: "Moray",
      },
    ],
    GRA: [
      {
        code: "S12000033",
        name: "Aberdeen City",
      },
      {
        code: "S12000034",
        name: "Aberdeenshire",
      },
    ],
    TAY: [
      {
        code: "S12000042",
        name: "Dundee City",
      },
      {
        code: "S12000041",
        name: "Angus",
      },
      {
        code: "S12000048",
        name: "Perth and Kinross",
      },
      {
        code: "S12000047",
        name: "Fife",
      },
      {
        code: "S12000030",
        name: "Stirling",
      },
    ],
    STH: [
      {
        code: "S12000026",
        name: "Scottish Borders",
      },
      {
        code: "S12000006",
        name: "Dumfries and Galloway",
      },
      {
        code: "S12000008",
        name: "East Ayrshire",
      },
      {
        code: "S12000021",
        name: "North Ayrshire",
      },
      {
        code: "S12000028",
        name: "South Ayrshire",
      },
      {
        code: "S12000029",
        name: "South Lanarkshire",
      },
    ],
    CSC: [
      {
        code: "S12000050",
        name: "North Lanarkshire",
      },
      {
        code: "S12000014",
        name: "Falkirk",
      },
      {
        code: "S12000005",
        name: "Clackmannanshire",
      },
    ],
  },
  WAL: {
    CDF: [
      {
        code: "W06000015",
        name: "Cardiff",
      },
      {
        code: "W06000014",
        name: "Vale of Glamorgan",
      },
      {
        code: "W06000021",
        name: "Monmouthshire",
      },
      {
        code: "W06000022",
        name: "Newport",
      },
    ],
    SWA: [
      {
        code: "W06000011",
        name: "Swansea",
      },
      {
        code: "W06000010",
        name: "Carmarthenshire",
      },
      {
        code: "W06000009",
        name: "Pembrokeshire",
      },
      {
        code: "W06000013",
        name: "Bridgend",
      },
      {
        code: "W06000012",
        name: "Neath Port Talbot",
      },
    ],
    VAL: [
      {
        code: "W06000016",
        name: "Rhondda Cynon Taf",
      },
      {
        code: "W06000024",
        name: "Merthyr Tydfil",
      },
      {
        code: "W06000018",
        name: "Caerphilly",
      },
      {
        code: "W06000019",
        name: "Blaenau Gwent",
      },
      {
        code: "W06000020",
        name: "Torfaen",
      },
    ],
    MWA: [
      {
        code: "W06000023",
        name: "Powys",
      },
      {
        code: "W06000008",
        name: "Ceredigion",
      },
    ],
    NWW: [
      {
        code: "W06000001",
        name: "Isle of Anglesey",
      },
      {
        code: "W06000002",
        name: "Gwynedd",
      },
      {
        code: "W06000003",
        name: "Conwy",
      },
      {
        code: "W06000004",
        name: "Denbighshire",
      },
    ],
    NEW: [
      {
        code: "W06000005",
        name: "Flintshire",
      },
      {
        code: "W06000006",
        name: "Wrexham",
      },
    ],
  },
} as const;

export function successorCouncilSeats(countryId: "SCO" | "WAL"): Record<string, number> {
  return Object.fromEntries(
    Object.entries(SUCCESSOR_REGION_COUNCILS[countryId]).map(([id, councils]) => [
      id,
      councils.length,
    ])
  );
}
