import { NextRequest, NextResponse } from "next/server";
import { CDN_HERO_ACTIONS_URL } from "@/lib/images/staticCdnAssets";

const HERO_URLS: Record<string, string> = {
  "white-house":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/White_House_Washington.JPG/1280px-White_House_Washington.JPG",
  cabinet:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/President_Barack_Obama_meets_with_members_of_his_Cabinet_in_the_Cabinet_Room_at_the_White_House.jpg/1280px-President_Barack_Obama_meets_with_members_of_his_Cabinet_in_the_Cabinet_Room_at_the_White_House.jpg",
  actions: CDN_HERO_ACTIONS_URL,
  politicians:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Barack_Obama_Inauguration.jpg/1280px-Barack_Obama_Inauguration.jpg",
  parties: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Floor_of_2012_RNC.jpg",
  "house-of-commons":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Palace_of_Westminster%2C_London_-_Feb_2007.jpg/1280px-Palace_of_Westminster%2C_London_-_Feb_2007.jpg",
  "downing-street":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Larry_the_Cat_walking_towards_the_door_of_no10_downing_st.jpg/1280px-Larry_the_Cat_walking_towards_the_door_of_no10_downing_st.jpg",
  // First Minister's official residence, 6 Charlotte Square, Edinburgh.
  "bute-house": "https://commons.wikimedia.org/wiki/Special:FilePath/Bute_House.jpg?width=1280",
  // Senedd, home of the Welsh Government / Welsh Parliament, Cardiff Bay.
  senedd: "https://commons.wikimedia.org/wiki/Special:FilePath/Senedd.jpg?width=1280",
  // The Scottish Parliament Building, Holyrood, Edinburgh.
  holyrood:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Scottish_Parliament,_Edinburgh.jpg?width=1280",
  // The Moscow Kremlin seen from the Bolshoy Kamenny Bridge — RU executive.
  kremlin:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Moscow_Kremlin_from_Kamenny_bridge.jpg?width=1280",
  // The Grand Kremlin Palace — where the Supreme Soviet convenes.
  "grand-kremlin-palace":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Grand_Kremlin_Palace,_Moscow.jpg?width=1280",
  // Seat of the Volkskammer, East Berlin — DD executive hub.
  volkskammer:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Palast_der_Republik_DDR_1977.jpg?width=1280",
  // Altes Stadthaus, Berlin — seat of the DD Council of Ministers.
  "altes-stadthaus":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Altes_Stadthaus,_Berlin,_160213,_ako.jpg?width=1280",
  // Supreme Soviet seat in Riga — BAL executive hub.
  baltics:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Main_building_of_the_Saeima.jpg?width=1280",
  // Çankaya Mansion, Ankara — TR executive (era-appropriate colourised LOC photo).
  cankaya:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Turkey._Ankara._Palace_of_Attaturk_(i.e.,_Ataturk)_LOC_matpc.16728_(Colourised).jpg?width=1280",
  // Maximos Mansion, Athens — GR executive seat.
  "maximos-mansion":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Maximos_Mansion_(Athens).jpg?width=1280",
  // Federal Chancellery at Ballhausplatz, Vienna — AT executive seat.
  ballhausplatz:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Bundeskanzleramt_Ballhausplatz_Wien_2007.jpg?width=1280",
  // Government Palace (Valtioneuvoston linna), Helsinki — FI executive seat.
  "government-palace-helsinki":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Valtioneuvoston_linna.jpg?width=1280",
  "federal-reserve":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Federal_Reserve.jpg/960px-Federal_Reserve.jpg",
  "us-overview-mount-rushmore":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/HDR_Mount_Rushmore.jpg/1280px-HDR_Mount_Rushmore.jpg",
  changelog:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/DEC_VT100_terminal.jpg/1280px-DEC_VT100_terminal.jpg",
  "national-diet":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Diet_of_Japan_Kokkai_2009.jpg/1280px-Diet_of_Japan_Kokkai_2009.jpg",
  kantei:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Kantei_PM_Japan_Residence.jpg/1280px-Kantei_PM_Japan_Residence.jpg",
  "bank-of-japan":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/Bank_of_Japan_2010.jpg/1280px-Bank_of_Japan_2010.jpg",
  "bank-of-england":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Bank_of_England_Building%2C_London%2C_UK_-_Diliff.jpg/960px-Bank_of_England_Building%2C_London%2C_UK_-_Diliff.jpg",
  ecb: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/European_Central_Bank_building%2C_Frankfurt%2C_2015.jpg/1280px-European_Central_Bank_building%2C_Frankfurt%2C_2015.jpg",
  "peoples-bank-of-china":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/People%27s_Bank_of_China_HQ_%28cropped%29.jpg/960px-People%27s_Bank_of_China_HQ_%28cropped%29.jpg",
  "great-hall-of-the-people":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/China_Senate_House.jpg/1280px-China_Senate_House.jpg",
  zhongnanhai:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Xinhua_Gate.jpg/1280px-Xinhua_Gate.jpg",
  // The National Assembly Complex, Abuja — seat of Nigeria's bicameral legislature.
  "national-assembly":
    "https://commons.wikimedia.org/wiki/Special:FilePath/National%20Assembly%20Complex%2C%20Abuja.jpg?width=1280",
  "banco-central-do-brasil":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Banco_Central_do_Brasil%2C_Bras%C3%ADlia.jpg/1280px-Banco_Central_do_Brasil%2C_Bras%C3%ADlia.jpg",
  // IMF Headquarters Building 1, Washington DC. Resolved via Wikimedia
  // search API (filename = "IMF_building_HR.jpg", hash directory d/d3).
  imf: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/IMF_building_HR.jpg/1280px-IMF_building_HR.jpg",
  // Official IMF Seal (circular globe + "INTERNATIONAL MONETARY FUND" text).
  // SVG version, hash directory 3/3e.
  "imf-logo": "https://upload.wikimedia.org/wikipedia/commons/3/3e/IMF-Seal_ENG_RGB.svg",
  /* ── Commodity heroes ── */
  "commodity-steel":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Showa_Steel_Works.JPG/1280px-Showa_Steel_Works.JPG",
  "commodity-electronics":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/TSMC_Fab5.JPG/1280px-TSMC_Fab5.JPG",
  "commodity-energy":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Anacortes_Refinery_31911.JPG/1280px-Anacortes_Refinery_31911.JPG",
  "commodity-chemicals":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/BASF_Werk_Ludwigshafen_1881.JPG/1280px-BASF_Werk_Ludwigshafen_1881.JPG",
  "commodity-pharmaceuticals": "https://commons.wikimedia.org/wiki/Special:FilePath/Pill_3.jpg",
  "commodity-fertilizers":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Horsedrawn_ground_driven_fertiliser_spreader_with_driver_(5570144343).jpg",
  "commodity-food":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/CSIRO_ScienceImage_4486_Harvesting_wheat.jpg/1280px-CSIRO_ScienceImage_4486_Harvesting_wheat.jpg",
  "commodity-building-materials":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/HK_Central_Piers_construction_site_building_material_steel.JPG/1280px-HK_Central_Piers_construction_site_building_material_steel.JPG",
  "commodity-construction-services":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Construction_workers.JPG",
  "commodity-healthcare-services":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Hospital_ward.jpg",
  "commodity-real-estate-services":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Lower-Manhattan-New-York-skyline-2014.jpg",
  "commodity-software":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Wikimedia_Foundation_Servers-8055_14.jpg/1280px-Wikimedia_Foundation_Servers-8055_14.jpg",
  "commodity-financial-services":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/USA-NYC-New_York_Stock_Exchange.JPG/1280px-USA-NYC-New_York_Stock_Exchange.JPG",
  "commodity-advertising":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Broadway_and_Times_Square_by_night.jpg/1280px-Broadway_and_Times_Square_by_night.jpg",
  "commodity-vehicles":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Hyundai_car_assembly_line.jpg/1280px-Hyundai_car_assembly_line.jpg",
  "commodity-retail":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Macys_dep_store.JPG/1280px-Macys_dep_store.JPG",
  "commodity-freight":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Maersk_container_ship_002.JPG/1280px-Maersk_container_ship_002.JPG",
  "commodity-consulting-services":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Booz_Allen_Hamilton_in_Washington_D.C..jpg/1280px-Booz_Allen_Hamilton_in_Washington_D.C..jpg",
  "commodity-iron":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Iron_Ore_factory.jpg/1280px-Iron_Ore_factory.jpg",
  "commodity-coal":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/North_Antelope_Rochelle_Mine_%283910811767%29.jpg/1280px-North_Antelope_Rochelle_Mine_%283910811767%29.jpg",
  "commodity-oil":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Oil_platform_P-51_%28Brazil%29.jpg/1280px-Oil_platform_P-51_%28Brazil%29.jpg",
  "commodity-rare-earth": "https://upload.wikimedia.org/wikipedia/commons/5/55/Rareearthoxides.jpg",
};

// GET /api/images/hero/[slug] — Redirects to the hero banner image for the given slug.
// Using a redirect instead of proxying eliminates function execution time and prevents timeouts.
// Auth: public
// Errors: 404
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = HERO_URLS[slug];
  if (!url) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return NextResponse.redirect(url, { status: 307 });
}
