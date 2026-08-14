/**
 * Cabinet positions (15 principal officers).
 * Order matches presidential line of succession (after VP).
 */
export const CABINET_POSITIONS = [
  {
    id: "secretary_of_state",
    yearEnabled: 1775,
    name: "Secretary of State",
    order: 1,
    description:
      "Leads U.S. foreign policy, diplomatic relations, and international negotiations. Represents the United States in foreign affairs, oversees the State Department and diplomatic missions worldwide, advises the President on international matters and treaties, and coordinates with allies to advance American interests abroad.",
  },
  {
    id: "secretary_of_treasury",
    yearEnabled: 1775,
    name: "Secretary of the Treasury",
    order: 2,
    description:
      "Manages federal finances, tax collection, and government revenue. Produces currency through the U.S. Mint and Bureau of Engraving, oversees economic policy and financial regulations, advises the President on fiscal matters, manages national debt, and coordinates international monetary policy through institutions like the IMF.",
  },
  {
    id: "secretary_of_defense",
    yearEnabled: 1775,
    name: "Secretary of Defense",
    order: 3,
    description:
      "Oversees the armed forces, military operations, and defense policy. Provides civilian leadership of the Department of Defense, commands the Army, Navy, Air Force, and Marines through the Joint Chiefs of Staff, manages defense budgets and procurement, and advises the President on national security and military strategy.",
  },
  {
    id: "attorney_general",
    yearEnabled: 1775,
    name: "Attorney General",
    order: 4,
    description:
      "Serves as the nation's chief law enforcement officer and top legal advisor. Heads the Department of Justice, oversees federal prosecutors and the FBI, enforces civil rights laws, prosecutes federal crimes, defends the government in legal matters, and advises the President and Cabinet on constitutional and legal issues.",
  },
  {
    id: "secretary_of_interior",
    yearEnabled: 1775,
    name: "Secretary of the Interior",
    order: 5,
    description:
      "Manages federal lands, natural resources, and Native American affairs. Oversees the National Park Service, Bureau of Land Management, U.S. Fish and Wildlife Service, and Bureau of Indian Affairs. Protects wildlife refuges, manages mineral rights and oil leases, and coordinates conservation efforts across public lands.",
  },
  {
    id: "secretary_of_agriculture",
    yearEnabled: 1775,
    name: "Secretary of Agriculture",
    order: 6,
    description:
      "Oversees farming, forestry, and food safety programs. Manages agricultural policy, crop subsidies, and farm support programs. Administers rural development initiatives, the Forest Service, and nutrition assistance programs including SNAP (food stamps). Regulates food safety standards and supports American farmers and agricultural exports.",
  },
  {
    id: "secretary_of_commerce",
    yearEnabled: 1775,
    name: "Secretary of Commerce",
    order: 7,
    description:
      "Promotes economic growth, business development, and international trade. Oversees the U.S. Patent and Trademark Office, Census Bureau, National Oceanic and Atmospheric Administration (NOAA), and National Weather Service. Supports American businesses, manages economic data collection, regulates commerce, and advises on trade policy.",
  },
  {
    id: "secretary_of_labor",
    yearEnabled: 1775,
    name: "Secretary of Labor",
    order: 8,
    description:
      "Protects workers' rights, wages, and workplace welfare. Enforces federal labor laws and workplace safety standards through OSHA. Manages unemployment insurance programs, job training initiatives, and workforce development. Oversees wage and hour regulations, collective bargaining rights, and ensures fair treatment of American workers.",
  },
  {
    id: "secretary_of_health",
    name: "Secretary of Health and Human Services",
    order: 9,
    yearEnabled: 1953,
    // Stays "Health, Education, and Welfare" (carrying education + welfare levers)
    // until the Department of Education Act splits Education off — then it is
    // styled HHS via renameOnDepartmentSplit. The old year-1980 auto-flip is gone
    // (operator decision 2026-08-13: the split is legislation-gated, not automatic).
    namesByYear: [{ from: 1953, name: "Secretary of Health, Education, and Welfare" }],
    renameOnDepartmentSplit: {
      whenSeatEnabled: "secretary_of_education",
      name: "Secretary of Health and Human Services",
    },
    description:
      "Oversees public health, medical research, and social services nationwide. Manages Medicare and Medicaid programs, the Centers for Disease Control and Prevention (CDC), Food and Drug Administration (FDA), and National Institutes of Health (NIH). Protects public health, regulates pharmaceuticals and medical devices, and administers health insurance programs.",
  },
  {
    id: "secretary_of_hud",
    yearEnabled: 1965,
    name: "Secretary of Housing and Urban Development",
    order: 10,
    description:
      "Promotes affordable housing, home ownership, and community development. Enforces fair housing laws and prevents discrimination in housing markets. Oversees federal housing assistance programs, public housing authorities, urban renewal initiatives, and homelessness prevention efforts. Manages HUD programs that support low-income families and revitalize communities.",
  },
  {
    id: "secretary_of_transportation",
    yearEnabled: 1967,
    name: "Secretary of Transportation",
    order: 11,
    description:
      "Oversees national transportation systems and infrastructure. Manages the Federal Highway Administration, Federal Aviation Administration (FAA), Federal Railroad Administration, and public transit programs. Ensures transportation safety, regulates airlines and railroads, develops infrastructure policy, and coordinates funding for highways, bridges, airports, and mass transit.",
  },
  {
    id: "secretary_of_energy",
    yearEnabled: 1977,
    name: "Secretary of Energy",
    order: 12,
    description:
      "Manages national energy policy, nuclear security, and energy research. Oversees the electrical power grid, energy efficiency standards, and renewable energy development. Maintains the nation's nuclear weapons stockpile through the National Nuclear Security Administration. Coordinates energy independence efforts and advances scientific research through national laboratories.",
  },
  {
    id: "secretary_of_education",
    // Never auto-enables by year (was 1980). The Department of Education is carved
    // out of HEW only when the Department of Education Act passes, which records
    // this seat id in gameState.manuallyEnabledSeats (see rosterEra.isSeatActive).
    yearEnabled: 9999,
    name: "Secretary of Education",
    order: 13,
    description:
      "Oversees federal education policy, funding, and programs. Manages student financial aid including Pell Grants and federal student loans. Enforces educational civil rights laws, ensures equal access to education, collects data on school performance, and distributes funding to support K-12 schools and higher education institutions nationwide.",
  },
  {
    id: "secretary_of_veterans",
    yearEnabled: 1989,
    name: "Secretary of Veterans Affairs",
    order: 14,
    description:
      "Serves military veterans and their families through comprehensive support programs. Provides healthcare through VA hospitals and clinics, administers disability compensation and pension benefits, manages the GI Bill education benefits, oversees veterans' home loans, and maintains national cemeteries and memorial services for those who served.",
  },
  {
    id: "secretary_of_homeland",
    yearEnabled: 2002,
    name: "Secretary of Homeland Security",
    order: 15,
    description:
      "Protects the homeland from terrorism, natural disasters, and security threats. Manages border security through Customs and Border Protection, oversees immigration enforcement and citizenship services, coordinates cybersecurity efforts, and directs disaster response and recovery through FEMA. Created after September 11, 2001 to consolidate security functions.",
  },
] as const;

export type CabinetPositionId = (typeof CABINET_POSITIONS)[number]["id"];

export function getCabinetPositionById(id: string): (typeof CABINET_POSITIONS)[number] | undefined {
  return CABINET_POSITIONS.find((p) => p.id === id);
}
