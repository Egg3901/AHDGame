/**
 * Source URLs for static images migrated to R2 (`static/{category}/{slug}.webp`).
 * Used by scripts/fetch-all-static-images.mjs — do not import from app code.
 */

/** @type {Record<string, string>} slug → source URL */
export const HERO_SOURCES = {
  "white-house":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/White_House_Washington.JPG/1280px-White_House_Washington.JPG",
  cabinet:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/President_Barack_Obama_meets_with_members_of_his_Cabinet_in_the_Cabinet_Room_at_the_White_House.jpg/1280px-President_Barack_Obama_meets_with_members_of_his_Cabinet_in_the_Cabinet_Room_at_the_White_House.jpg",
  actions:
    "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1600&q=85",
  politicians:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Barack_Obama_Inauguration.jpg/1280px-Barack_Obama_Inauguration.jpg",
  parties: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Floor_of_2012_RNC.jpg",
  "house-of-commons":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Palace_of_Westminster%2C_London_-_Feb_2007.jpg/1280px-Palace_of_Westminster%2C_London_-_Feb_2007.jpg",
  "downing-street":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Larry_the_Cat_walking_towards_the_door_of_no10_downing_st.jpg/1280px-Larry_the_Cat_walking_towards_the_door_of_no10_downing_st.jpg",
  reichstag:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Berlin_reichstag_west_panorama_2.jpg/1280px-Berlin_reichstag_west_panorama_2.jpg",
  "government-buildings-dublin":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Government_Buildings%2C_Dublin.jpg/1280px-Government_Buildings%2C_Dublin.jpg",
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
  "banco-central-do-brasil":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Banco_Central_do_Brasil%2C_Bras%C3%ADlia.jpg/1280px-Banco_Central_do_Brasil%2C_Bras%C3%ADlia.jpg",
  "palacio-do-planalto":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Palacio_do_Planalto_GG.jpg/1280px-Palacio_do_Planalto_GG.jpg",
  "aso-rock":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Abuja_City_Gate.jpg/1280px-Abuja_City_Gate.jpg",
  "central-bank-of-nigeria":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Central_Bank_of_Nigeria%2C_Abuja.jpg/1280px-Central_Bank_of_Nigeria%2C_Abuja.jpg",
  imf: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/IMF_building_HR.jpg/1280px-IMF_building_HR.jpg",
  "imf-logo": "https://upload.wikimedia.org/wikipedia/commons/3/3e/IMF-Seal_ENG_RGB.svg",
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
  "commodity-copper":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Copper_electrolytic_and_1cm3_cube.jpg/1280px-Copper_electrolytic_and_1cm3_cube.jpg",
  "commodity-timber":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Forestry_work_in_Finland.jpg/1280px-Forestry_work_in_Finland.jpg",
  "commodity-natural-gas":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Natural_gas_flaring_off_the_coast_of_Nigeria.jpg/1280px-Natural_gas_flaring_off_the_coast_of_Nigeria.jpg",
  "commodity-ordnance":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/155mm_ammunition.jpg/1280px-155mm_ammunition.jpg",
  "commodity-plastics":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Plastic_pellets.jpg/1280px-Plastic_pellets.jpg",
  "commodity-network-services":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Fiber_optic_cables.jpg/1280px-Fiber_optic_cables.jpg",
  "commodity-entertainment-services":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Hollywood_Sign_%28Zuschnitt%29.jpg/1280px-Hollywood_Sign_%28Zuschnitt%29.jpg",
};

/** @type {Record<string, string>} */
export const MISC_SOURCES = {
  "congress-senate":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Old_Senate_chambers_US_Capitol.jpg/1280px-Old_Senate_chambers_US_Capitol.jpg",
  "congress-house":
    "https://upload.wikimedia.org/wikipedia/commons/9/90/United_States_House_of_Representatives_chamber.jpg",
  news: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/An_old_man_in_newsagent%27s_shop%2C_Paris_September_2011.jpg/960px-An_old_man_in_newsagent%27s_shop%2C_Paris_September_2011.jpg",
  stockmarket:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg/960px-NY_stock_exchange_traders_floor_LC-U9-10548-6.jpg",
  "bundestag-chamber":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Berlin_reichstag_west_panorama_2.jpg/1280px-Berlin_reichstag_west_panorama_2.jpg",
};

/** @type {Record<string, string>} countryId → source URL (330px PNG thumbs) */
export const SEAL_SOURCES = {
  US: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Seal_of_the_President_of_the_United_States.svg/330px-Seal_of_the_President_of_the_United_States.svg.png",
  UK: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg/330px-Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg.png",
  DE: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Bundesadler_Bundesorgane.svg/330px-Bundesadler_Bundesorgane.svg.png",
  JP: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Emblem_of_the_Prime_Minister_of_Japan.svg/330px-Emblem_of_the_Prime_Minister_of_Japan.svg.png",
  IE: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Coat_of_arms_of_Ireland.svg/330px-Coat_of_arms_of_Ireland.svg.png",
  CN: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/National_Emblem_of_the_People%27s_Republic_of_China.svg/330px-National_Emblem_of_the_People%27s_Republic_of_China.svg.png",
  BR: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Coat_of_arms_of_Brazil.svg/330px-Coat_of_arms_of_Brazil.svg.png",
  NG: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Coat_of_arms_of_Nigeria.svg/330px-Coat_of_arms_of_Nigeria.svg.png",
};

export const CDN_PUBLIC_BASE = "https://cdn.ahousedividedgame.com";

export function staticCdnUrl(category, slug, ext = "webp") {
  return `${CDN_PUBLIC_BASE}/static/${category}/${slug}.${ext}`;
}
