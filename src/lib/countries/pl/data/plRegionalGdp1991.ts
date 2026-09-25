import {
  PL_1991_MACROREGION_POPULATION,
  PL_1991_MACROREGION_VOIVODESHIPS,
  PL_1991_VOIVODESHIP_POPULATION,
} from "@/lib/countries/pl/data/plPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";

/**
 * GUS's 1992 GDP per resident (Poland=100, factor cost) for the 22 historical
 * voivodeships reproduced in World Bank report 30078, Table 5.8, page 123:
 * https://documents1.worldbank.org/curated/en/505321468776354414/pdf/300780v20white0cover01public1.pdf
 * The source covers selected voivodeships, not all 49. Every game macroregion
 * has at least one observed constituent. We population-weight observations
 * within each macroregion, then scale its 1991 census population to the
 * nationally observed FY1991 GDP. This is a documented backcast from the
 * first published post-transition regional GDP, not a claim that GUS published
 * a complete 1991 regional series.
 */
export const PL_1992_SELECTED_GDP_PER_CAPITA_INDEX = {
  Warszawskie: 158,
  Gdanskie: 105,
  Krakowskie: 117,
  Poznanskie: 132,
  Szczecinskie: 127,
  Wroclawskie: 105,
  Gorzowskie: 86,
  Zielonogorskie: 105,
  Opolskie: 100,
  Legnickie: 126,
  Piotrkowskie: 120,
  Plockie: 149,
  Katowickie: 116,
  Lodzkie: 105,
  Walbrzyskie: 80,
  Bialskopodlaskie: 79,
  Chelmskie: 87,
  Ostroleckie: 70,
  Radomskie: 78,
  Slupskie: 77,
  Suwalskie: 65,
  Zamojskie: 73,
} as const;

export const PL_1991_MACROREGION_OUTPUT_INDEX = Object.fromEntries(
  Object.entries(PL_1991_MACROREGION_VOIVODESHIPS).map(([regionId, voivodeships]) => {
    const observed = voivodeships.filter((name) => name in PL_1992_SELECTED_GDP_PER_CAPITA_INDEX);
    if (observed.length === 0) throw new Error(`No observed output anchor for ${regionId}`);
    const observedPopulation = observed.reduce(
      (sum, name) => sum + PL_1991_VOIVODESHIP_POPULATION[name],
      0
    );
    const weightedOutput = observed.reduce(
      (sum, name) =>
        sum +
        PL_1991_VOIVODESHIP_POPULATION[name] *
          PL_1992_SELECTED_GDP_PER_CAPITA_INDEX[
            name as keyof typeof PL_1992_SELECTED_GDP_PER_CAPITA_INDEX
          ],
      0
    );
    return [regionId, weightedOutput / observedPopulation];
  })
) as Record<keyof typeof PL_1991_MACROREGION_POPULATION, number>;

export const PL_1991_ESTIMATED_REGION_GDP_PLZ = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.PL,
  PL_1991_MACROREGION_POPULATION,
  PL_1991_MACROREGION_OUTPUT_INDEX
);
