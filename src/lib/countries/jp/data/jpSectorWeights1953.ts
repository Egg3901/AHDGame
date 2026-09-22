import type { SectorWeightMap } from "@/lib/seeds/reference/sectorSeedWeights1953";

/**
 * Japan's 1953 sector weights.
 *
 * Moved out of `src/lib/seeds/reference/sectorSeedWeights1953.ts`, which now
 * forwards to this. Values unchanged.
 *
 * ⚠ THIS IS A BALANCE SURFACE, NOT A DESCRIPTION. The weights seed the 1953
 * economy's sector mix, so editing one is an economy change and needs a
 * simulation report, not a citation. The trailing comments explain why each
 * number is what it is; they do not license changing it.
 */
export const JP_SECTOR_WEIGHTS_1953: SectorWeightMap = {
  manufacturing: 30, // Korean War boom; US procurement accelerated recovery; steel/textiles
  agriculture: 12, // land reform (1947-50) complete; rice dominant; ~40% of labour
  construction: 10, // war destruction rebuilding; Japan Housing Corporation est. 1955 (just before)
  energy: 8, // coal dominant; electric power reconstruction (TEPCO etc.)
  automobiles: 5, // Toyota/Nissan just starting passenger cars; military trucks→civilian
  logistics: 5, // Japan National Railways rebuilding; port recovery
  chemical_industries: 4, // zaibatsu successor chemi-firms (Mitsui Chemicals)
  retail: 4, // department stores (depato) recovering; markets dominant
  defense: 3, // JSDF established 1954; US-Japan Security Treaty 1951; rearmament pressure
  financial: 3, // Bank of Japan; zaibatsu successor banks; capital controls
  extraction: 3, // coal mining (Kyushu/Hokkaido); copper/zinc
  real_estate: 2, // massive housing shortage from firebombing; small formal market
  healthcare: 2, // health insurance law 1958 pending; small but growing
  telecommunications: 2, // NTT predecessor; rebuilding
  media_entertainment: 4, // Yomiuri/Asahi newspapers; NHK radio; TV just launching 1953; Toho/Toei cinema boom; Godzilla (1954); pachinko
  technology: 0, // transistors licensed from Bell Labs 1953 (Sony); zero commercial sector
};
