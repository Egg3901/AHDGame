/**
 * Bootstrap wrapper for {@link seedNpcBanks}. Lives under admin/seed so the
 * world seed pipeline registers it the same way as sibling seeders
 * (seedNppCorporations, seedUnownedSectors, …).
 */

export { seedNpcBanks, type SeedNpcBanksResult } from "@/lib/banking/npcBanks";
