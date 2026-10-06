/**
 * Regional choices in the 1991 reset. These are local service
 * and state-competent alternatives, not copies of a national statute. They
 * use reviewed, visibly provisional prices and outcome calibration for the
 * reset release. Future telemetry may support a later balance revision.
 */
import type { LegislativePosition } from "./catalog";
import type { ResetCountry } from "./fundingOwner";

export interface RegionalLawLevel {
  familyId: string;
  country: ResetCountry;
  position: LegislativePosition;
  title: string;
  description: string;
  authorityKind: "state_statute" | "delegated_service_package";
  fundingAccount: "regional_budget";
  sourceAnchor: string;
}

const SOURCE_US = "https://www.cdc.gov/field-epi-manual/php/chapters/legal.html";
const SOURCE_UK = "https://www.legislation.gov.uk/ukpga/1990/19/contents/enacted";
const SOURCE_JP = "https://www.mhlw.go.jp/www1/english/wp_5/vol2/p2c3.html";

interface LocalRoute {
  familyId: string;
  countries?: readonly ResetCountry[];
  levels: readonly { title: string; description: string }[];
}

/** Five locally authored service routes per family, separate from national law. */
const localRoutes: readonly LocalRoute[] = [
  {
    familyId: "L01",
    levels: [
      {
        title: "Household Support Guarantee",
        description:
          "Fund broad local household assistance and work-linked support within existing tax powers.",
      },
      {
        title: "Low-Income Work Supplement",
        description:
          "Target verified in-work aid and local charge relief to low-income households.",
      },
      {
        title: "Local Household Relief Compact",
        description:
          "Pair modest hardship support with simplified access to lawful local relief programs.",
      },
      {
        title: "Targeted Work Incentives",
        description:
          "Direct short-term support to verified employment transitions and publish take-up costs.",
      },
      {
        title: "Open Work Support Partnerships",
        description:
          "Contract qualified job-support services with results audits and a limited hardship backstop.",
      },
    ],
  },
  {
    familyId: "L02",
    levels: [
      {
        title: "Community Benefit Supplement",
        description:
          "Add broad locally funded support to national benefits without rewriting national entitlement.",
      },
      {
        title: "Hardship Benefit Top-Up",
        description:
          "Concentrate local benefit supplements on verified gaps in sickness and unemployment support.",
      },
      {
        title: "Benefits Access Compact",
        description:
          "Coordinate enrollment help and modest top-ups with clear eligibility and appeals.",
      },
      {
        title: "Targeted Return-to-Work Aid",
        description:
          "Offer time-limited local supplements tied to job placement and hardship protections.",
      },
      {
        title: "Flexible Benefit Navigation",
        description:
          "Use qualified community providers to improve claims access while limiting new benefit spending.",
      },
    ],
  },
  {
    familyId: "L03",
    levels: [
      {
        title: "Public Investment Districts",
        description:
          "Build shared industrial sites and utilities for employers that meet local jobs commitments.",
      },
      {
        title: "Disadvantaged Enterprise Fund",
        description:
          "Target site grants and lawful local relief to firms investing in high-unemployment districts.",
      },
      {
        title: "Regional Investment Compact",
        description:
          "Offer common site services and publish job, wage, and clawback measures for recipients.",
      },
      {
        title: "Competitive Site Incentives",
        description:
          "Bid limited infrastructure assistance for credible private investment with clawbacks.",
      },
      {
        title: "Open Enterprise Zones",
        description:
          "Simplify local permits and site access while charging transparent infrastructure costs.",
      },
    ],
  },
  {
    familyId: "L04",
    levels: [
      {
        title: "Public Fair-Work Standard",
        description:
          "Use public employment and procurement to support safe work and stronger wages within national law.",
      },
      {
        title: "Low-Wage Compliance Fund",
        description:
          "Target inspections and employer assistance where wage violations and unsafe work are documented.",
      },
      {
        title: "Regional Workplace Compact",
        description:
          "Set clear public-contract labor expectations and coordinate lawful enforcement referrals.",
      },
      {
        title: "Flexible Hiring with Safeguards",
        description:
          "Ease public-contract hiring rules while retaining wage, safety, and complaint protections.",
      },
      {
        title: "Open Local Labor Markets",
        description:
          "Reduce unnecessary local license barriers and keep national worker protections enforceable.",
      },
    ],
  },
  {
    familyId: "L05",
    levels: [
      {
        title: "Public Market Access Program",
        description:
          "Provide shared facilities and transparent public purchasing access for small entrants.",
      },
      {
        title: "Small Entrant Procurement",
        description:
          "Target bid assistance and smaller public contracts to capable new local suppliers.",
      },
      {
        title: "Fair Entry Compact",
        description:
          "Publish local permit times and procurement awards while keeping inspection standards.",
      },
      {
        title: "Competitive Licensing Review",
        description: "Remove duplicative local permits with transparent appeal and quality checks.",
      },
      {
        title: "Open Local Market Entry",
        description:
          "Allow broad entry into lawful local services while policing fraud and unsafe providers.",
      },
    ],
  },
  {
    familyId: "L06",
    levels: [
      {
        title: "Regional Jobs Guarantee",
        description:
          "Fund public work placements and training in districts with persistent joblessness.",
      },
      {
        title: "Distressed District Jobs Fund",
        description:
          "Target employer placements, transit, and skills aid to the weakest local labor markets.",
      },
      {
        title: "Opportunity Partnership",
        description:
          "Coordinate training and vacancy matching with modest public placement support.",
      },
      {
        title: "Employer Placement Contracts",
        description:
          "Pay audited private placements for sustained work in high-unemployment communities.",
      },
      {
        title: "Open Hiring Districts",
        description:
          "Ease local business entry and recruitment frictions while preserving safety and wage law.",
      },
    ],
  },
  {
    familyId: "L08",
    levels: [
      {
        title: "Protected Service Budget",
        description:
          "Set a transparent local budget with stronger service reserves and an explicit borrowing plan.",
      },
      {
        title: "Priority Service Floor",
        description: "Ring-fence essential local claims and publish a medium-term deficit path.",
      },
      {
        title: "Balanced Regional Plan",
        description:
          "Align lawful local revenue, grants, and spending with public debt and arrears reports.",
      },
      {
        title: "Expenditure Review Rule",
        description:
          "Cap new discretionary commitments unless funded and audit existing contracts.",
      },
      {
        title: "Strict Local Debt Guard",
        description:
          "Restrict new borrowing and require explicit service-priority choices when revenue falls.",
      },
    ],
  },
  {
    familyId: "L09",
    levels: [
      {
        title: "Community Supply Reserve",
        description:
          "Build public emergency stocks and local distribution capacity for essential goods.",
      },
      {
        title: "High-Risk Supply Buffer",
        description:
          "Target reserve contracts to communities exposed to transport and fuel interruptions.",
      },
      {
        title: "Regional Shock Plan",
        description:
          "Coordinate inventories, relief eligibility, and transparent emergency release triggers.",
      },
      {
        title: "Competitive Reserve Contracts",
        description:
          "Purchase verified standby supply from qualified vendors with rotation and audit rules.",
      },
      {
        title: "Open Emergency Logistics",
        description:
          "Simplify licensed supply routes and storage permits while preserving emergency access.",
      },
    ],
  },
  {
    familyId: "L10",
    levels: [
      {
        title: "Universal School Access Guarantee",
        description:
          "Build public seats, transport, and fee relief in every underserved district, with audited intake targets.",
      },
      {
        title: "Attendance Gap Fund",
        description:
          "Target school transport and access grants to districts with the largest measured attendance gaps.",
      },
      {
        title: "District Access Compact",
        description:
          "Pair a basic school-place guarantee with local placement flexibility and public reporting.",
      },
      {
        title: "Portable School Seat Grants",
        description:
          "Fund eligible pupils directly while auditing participating schools for access and quality.",
      },
      {
        title: "Open Enrollment Network",
        description:
          "Expand approved public and independent places with portable support and transparent admissions rules.",
      },
    ],
  },
  {
    familyId: "L11",
    levels: [
      {
        title: "Teacher and School Rebuild",
        description:
          "Hire teachers and renovate deficient schools through a broad regional capital and staffing plan.",
      },
      {
        title: "Vacancy and Repair Fund",
        description:
          "Direct recruitment bonuses and repairs toward schools with verified staffing or building gaps.",
      },
      {
        title: "Classroom Capacity Compact",
        description:
          "Maintain core staffing while giving districts measured discretion over repair and hiring priorities.",
      },
      {
        title: "Flexible Teacher Contracts",
        description:
          "Offer targeted certification and pay flexibility under published qualification safeguards.",
      },
      {
        title: "School Workforce Autonomy",
        description:
          "Let schools reorganize staffing and facilities contracts while retaining inspection and safety duties.",
      },
    ],
  },
  {
    familyId: "L12",
    levels: [
      {
        title: "Common Curriculum and Remediation",
        description:
          "Fund a shared learning floor and broad remedial instruction across struggling schools.",
      },
      {
        title: "Targeted Learning Standards",
        description:
          "Set core reading and mathematics checks with extra support for low-attainment districts.",
      },
      {
        title: "Local Standards Compact",
        description:
          "Publish comparable attainment results while allowing locally chosen instruction beyond a core floor.",
      },
      {
        title: "School-Led Curriculum Choice",
        description:
          "Give schools wider curriculum choice within national requirements and disclose comparable results.",
      },
      {
        title: "Autonomous Learning Networks",
        description:
          "Enable diverse approved curricula while enforcing basic literacy, safety, and inspection standards.",
      },
    ],
  },
  {
    familyId: "L13",
    levels: [
      {
        title: "Public Skills and Training Corps",
        description:
          "Fund broad adult training places with public providers and employer placement commitments.",
      },
      {
        title: "Displaced Worker Apprenticeships",
        description:
          "Target apprenticeships and retraining to workers and towns with verified job losses.",
      },
      {
        title: "Regional Skills Compact",
        description:
          "Match training places to local vacancies through joint employer and public-provider planning.",
      },
      {
        title: "Employer Training Credits",
        description:
          "Pay audited credits for job-linked training and portable qualifications at approved providers.",
      },
      {
        title: "Open Skills Market",
        description:
          "Let accredited providers compete for outcome-based training contracts with fraud controls.",
      },
    ],
  },
  {
    familyId: "L14",
    levels: [
      {
        title: "Public College Access Expansion",
        description:
          "Add regional places, housing, and need-based support at eligible public higher-education institutions.",
      },
      {
        title: "Targeted Student Access Fund",
        description:
          "Fund travel, bursaries, and places for qualified applicants from low-access districts.",
      },
      {
        title: "Regional Campus Compact",
        description:
          "Coordinate campus places and modest student support with published completion measures.",
      },
      {
        title: "Portable Student Grants",
        description:
          "Offer means-tested grants usable at approved institutions with audited completion results.",
      },
      {
        title: "Competitive Campus Partnerships",
        description:
          "Contract with approved campuses for additional places while preserving entry and quality standards.",
      },
    ],
  },
  {
    familyId: "L15",
    levels: [
      {
        title: "Public Research Campus Network",
        description:
          "Fund shared laboratories, regional research staff, and open access for eligible local institutions.",
      },
      {
        title: "Regional Discovery Grants",
        description:
          "Target laboratory grants to underserved institutions and publish research milestones.",
      },
      {
        title: "University Research Compact",
        description:
          "Co-fund shared facilities with universities and require independent scientific review.",
      },
      {
        title: "Applied Research Vouchers",
        description:
          "Offer competitive research vouchers to accredited university and industry partnerships.",
      },
      {
        title: "Open Innovation Districts",
        description:
          "Ease access to private laboratory space and match only verified shared-facility commitments.",
      },
    ],
  },
  {
    familyId: "L16",
    levels: [
      {
        title: "Community Care Access Network",
        description:
          "Expand public primary-care sites and mobile teams while honoring national entitlement rules.",
      },
      {
        title: "Underserved Care Guarantee",
        description:
          "Place clinical teams in low-access districts and reimburse verified service gaps.",
      },
      {
        title: "Regional Care Access Compact",
        description:
          "Coordinate public and approved independent clinics against published patient-access targets.",
      },
      {
        title: "Portable Clinic Contracts",
        description:
          "Purchase additional appointments from audited providers where public capacity is short.",
      },
      {
        title: "Open Provider Access Network",
        description:
          "License more qualified providers with outcome reporting and emergency referral duties.",
      },
    ],
  },
  {
    familyId: "L17",
    levels: [
      {
        title: "Public Care Cost Shield",
        description:
          "Cover broad essential patient charges and negotiate common local purchasing terms.",
      },
      {
        title: "Low-Income Care Relief",
        description:
          "Target patient-fee relief and medicine assistance to households facing the highest burden.",
      },
      {
        title: "Transparent Care Prices",
        description: "Publish comparable local charges and preserve targeted hardship assistance.",
      },
      {
        title: "Competitive Care Purchasing",
        description:
          "Tender selected services with cost and quality audits while protecting urgent care access.",
      },
      {
        title: "Open Care Price Market",
        description:
          "Expand qualified provider choice and clear prices, retaining emergency and indigent safeguards.",
      },
    ],
  },
  {
    familyId: "L18",
    levels: [
      {
        title: "Hospital Capacity Guarantee",
        description:
          "Build public treatment capacity and staff hard-to-fill specialties across the region.",
      },
      {
        title: "Waiting-List Recovery Teams",
        description:
          "Fund extra shifts and specialist referrals for the longest verified treatment backlogs.",
      },
      {
        title: "Regional Throughput Compact",
        description:
          "Coordinate beds, referrals, and staffing with published wait and safety measures.",
      },
      {
        title: "Audited Treatment Contracts",
        description:
          "Buy spare capacity from qualified providers when contracted patients face long waits.",
      },
      {
        title: "Flexible Treatment Network",
        description:
          "Permit broader provider scheduling and referral choice while retaining quality inspection.",
      },
    ],
  },
  {
    familyId: "L20",
    levels: [
      {
        title: "Community Mental Care Network",
        description:
          "Staff regional counseling, crisis, and follow-up services with broad public access.",
      },
      {
        title: "High-Need Mental Care Fund",
        description:
          "Target crisis teams and outpatient places to districts with the greatest unmet need.",
      },
      {
        title: "Continuity of Care Compact",
        description:
          "Coordinate referrals, follow-up, and a basic counseling floor across approved providers.",
      },
      {
        title: "Outcome-Based Counseling",
        description:
          "Contract accredited counseling capacity and audit follow-up and patient safety.",
      },
      {
        title: "Flexible Mental Health Providers",
        description:
          "Open supervised entry for qualified community providers while maintaining crisis coverage.",
      },
    ],
  },
  {
    familyId: "L21",
    levels: [
      {
        title: "Universal Community Elder Care",
        description:
          "Expand publicly delivered home care and residential oversight for older residents.",
      },
      {
        title: "Frailty Support Guarantee",
        description:
          "Target home visits and respite places to older people with the highest assessed needs.",
      },
      {
        title: "Regional Care Continuity",
        description:
          "Coordinate family, public, and approved provider support through common care assessments.",
      },
      {
        title: "Portable Home-Care Support",
        description:
          "Fund means-tested care vouchers usable with inspected local home-care providers.",
      },
      {
        title: "Open Elder-Care Capacity",
        description:
          "Simplify qualified provider entry with inspection, complaints, and continuity safeguards.",
      },
    ],
  },
  {
    familyId: "L22",
    levels: [
      {
        title: "Public Homes and Serviced Land",
        description:
          "Build social housing and service land in shortage districts with anti-displacement protections.",
      },
      {
        title: "Affordable Sites Fund",
        description: "Target serviced plots and affordable units near jobs and existing transport.",
      },
      {
        title: "Faster Homes Compact",
        description:
          "Shorten approvals for compliant homes while reserving a modest affordable share.",
      },
      {
        title: "By-Right Infill Permits",
        description:
          "Allow code-compliant infill near utilities and transit without individual discretionary hearings.",
      },
      {
        title: "Broad Building Freedom",
        description:
          "Remove low-density barriers for safe projects and charge transparent infrastructure costs.",
      },
    ],
  },
  {
    familyId: "L23",
    levels: [
      {
        title: "Public Rent and Repair Shield",
        description:
          "Fund broad rent assistance and repairs for unsafe low-cost homes with fraud audits.",
      },
      {
        title: "Housing Burden Relief",
        description:
          "Target rent support and weatherization to households with the highest verified burdens.",
      },
      {
        title: "Stable Housing Compact",
        description:
          "Offer temporary hardship aid alongside faster repair and tenancy dispute resolution.",
      },
      {
        title: "Portable Housing Allowances",
        description:
          "Give means-tested tenants portable help while publishing local rent and vacancy data.",
      },
      {
        title: "Open Rental Supply",
        description:
          "Ease lawful rental entry and conversion while enforcing safety and fair-contract rules.",
      },
    ],
  },
  {
    familyId: "L24",
    levels: [
      {
        title: "Housing First Service Network",
        description:
          "Add public supportive housing and coordinated health services for unhoused residents.",
      },
      {
        title: "Targeted Shelter to Home",
        description:
          "Fund casework and permanent exits for the longest-staying shelter households.",
      },
      {
        title: "Coordinated Homelessness Response",
        description:
          "Link shelters, short-term assistance, and measured housing placements across districts.",
      },
      {
        title: "Outcome-Based Placement Contracts",
        description:
          "Pay inspected providers for sustained placements rather than occupancy alone.",
      },
      {
        title: "Flexible Emergency Lodging",
        description:
          "Open qualified low-cost lodging and rapid referral capacity with basic safety oversight.",
      },
    ],
  },
  {
    familyId: "L25",
    levels: [
      {
        title: "Public Road Renewal Corps",
        description:
          "Rebuild deteriorated local roads and bridges with a published safety and maintenance schedule.",
      },
      {
        title: "Dangerous Bridge Fund",
        description:
          "Prioritize repairs where inspections show the highest structural risk and traffic exposure.",
      },
      {
        title: "Asset Maintenance Compact",
        description:
          "Protect routine road upkeep while ranking capital repairs by measured condition and use.",
      },
      {
        title: "Competitive Repair Contracts",
        description:
          "Tender audited local repairs with warranty, completion, and pavement-quality checks.",
      },
      {
        title: "User-Funded Road Delivery",
        description:
          "Invite qualified private road maintenance with transparent user charges and public safety duties.",
      },
    ],
  },
  {
    familyId: "L26",
    levels: [
      {
        title: "Public Transit Expansion",
        description:
          "Add frequent buses and rail connections in underserved communities with accessible fares.",
      },
      {
        title: "Transit Gap Routes",
        description:
          "Subsidize routes linking low-access neighborhoods to major employment and services.",
      },
      {
        title: "Regional Service Coordination",
        description:
          "Coordinate routes, timetables, and transfers with a basic service floor and cost reporting.",
      },
      {
        title: "Competitive Route Franchises",
        description:
          "Tender time-limited routes to qualified operators with audited reliability and fare terms.",
      },
      {
        title: "Open Mobility Services",
        description:
          "Allow more licensed transit operators while preserving accessible routes and safety inspection.",
      },
    ],
  },
  {
    familyId: "L27",
    levels: [
      {
        title: "Public Communications Buildout",
        description:
          "Extend era-appropriate telephone and data access to underserved districts through public facilities.",
      },
      {
        title: "Rural Network Gaps Fund",
        description:
          "Pay verified connection grants in places with weak telephone or emerging data service.",
      },
      {
        title: "Regional Access Compact",
        description:
          "Coordinate public sites and carrier interconnection with measured household reach.",
      },
      {
        title: "Competitive Access Grants",
        description:
          "Tender connections to qualified carriers where bids meet coverage and service standards.",
      },
      {
        title: "Open Network Entry",
        description:
          "Simplify local siting for licensed networks while retaining interoperability and safety checks.",
      },
    ],
  },
  {
    familyId: "L28",
    levels: [
      {
        title: "Safe Water Works",
        description: "Rebuild public drinking-water and wastewater works in high-risk communities.",
      },
      {
        title: "Contaminated System Recovery",
        description:
          "Target treatment upgrades and pipe replacement where tests show unsafe service.",
      },
      {
        title: "Water Quality Compact",
        description:
          "Maintain inspections and planned repairs with public sampling and outage reports.",
      },
      {
        title: "Audited Utility Upgrades",
        description:
          "Procure qualified operators for measurable leakage and treatment improvements.",
      },
      {
        title: "Open Water Delivery",
        description:
          "Allow regulated utility contracts with enforceable safe-water, tariff, and continuity standards.",
      },
    ],
  },
  {
    familyId: "L29",
    levels: [
      {
        title: "Public Grid Resilience",
        description:
          "Reinforce regional substations and backup supply under a coordinated public outage plan.",
      },
      {
        title: "Outage Hotspot Fund",
        description:
          "Target line hardening and maintenance where households face repeated service failures.",
      },
      {
        title: "Grid Reliability Compact",
        description:
          "Set transparent maintenance and restoration targets with utilities under existing law.",
      },
      {
        title: "Performance Grid Contracts",
        description:
          "Tender qualified repair and backup capacity tied to verified outage reductions.",
      },
      {
        title: "Distributed Power Access",
        description:
          "Ease safe local generation and interconnection while retaining reliability obligations.",
      },
    ],
  },
  {
    familyId: "L30",
    levels: [
      {
        title: "Community Energy Security",
        description:
          "Fund public efficiency, diversified local supply, and emergency fuel arrangements.",
      },
      {
        title: "Fuel Exposure Relief",
        description:
          "Target efficiency and backup grants to households and facilities most exposed to supply shocks.",
      },
      {
        title: "Regional Energy Compact",
        description:
          "Coordinate utility planning, conservation, and emergency reserves within national energy law.",
      },
      {
        title: "Competitive Backup Supply",
        description:
          "Procure verified standby fuel and demand savings from qualified local suppliers.",
      },
      {
        title: "Open Local Energy Mix",
        description:
          "Streamline safe local generation and efficiency services while preserving emergency access.",
      },
    ],
  },
  {
    familyId: "L31",
    levels: [
      {
        title: "Clean Air Communities",
        description:
          "Fund public monitoring and local pollution-control works in high-exposure districts.",
      },
      {
        title: "Industrial Exposure Response",
        description:
          "Target inspections and cleanup to neighborhoods with verified harmful exposure.",
      },
      {
        title: "Regional Air Compact",
        description:
          "Coordinate inspections and mitigation plans within national emissions standards.",
      },
      {
        title: "Audited Emissions Upgrades",
        description:
          "Offer competitive facility-upgrade grants tied to measured local air improvement.",
      },
      {
        title: "Flexible Clean Production",
        description:
          "Allow alternative compliant controls with public measurements and enforceable exposure limits.",
      },
    ],
  },
  {
    familyId: "L32",
    levels: [
      {
        title: "Regional Disaster Shield",
        description:
          "Build public flood, storm, and emergency facilities with neighborhood preparedness teams.",
      },
      {
        title: "Highest-Risk Protection",
        description:
          "Target protective works and evacuation support to the most exposed settlements.",
      },
      {
        title: "Resilience Maintenance Compact",
        description:
          "Maintain warnings, drills, and priority defenses under a published regional risk plan.",
      },
      {
        title: "Risk-Reduction Contracts",
        description:
          "Purchase independently verified defenses and building retrofits from qualified suppliers.",
      },
      {
        title: "Private Resilience Incentives",
        description:
          "Reward safe retrofits and risk-aware siting while preserving public evacuation duties.",
      },
    ],
  },
  {
    familyId: "L33",
    levels: [
      {
        title: "Public Habitat Stewardship",
        description:
          "Acquire and restore connected habitats with staffed local conservation services.",
      },
      {
        title: "Threatened Habitat Fund",
        description: "Target restoration grants to land with verified species and watershed risks.",
      },
      {
        title: "Regional Conservation Compact",
        description:
          "Coordinate protected sites and working-land agreements with measurable habitat condition.",
      },
      {
        title: "Stewardship Incentives",
        description:
          "Pay landholders for independently verified conservation and public access outcomes.",
      },
      {
        title: "Flexible Working Lands",
        description:
          "Permit compatible use of protected land while enforcing core habitat and water safeguards.",
      },
    ],
  },
  {
    familyId: "L34",
    levels: [
      {
        title: "Community Safety Service",
        description:
          "Expand trained local responders, violence interruption, and accountable neighborhood patrols.",
      },
      {
        title: "Violence Hotspot Teams",
        description:
          "Target investigative and prevention teams where serious victimization is highest.",
      },
      {
        title: "Public Safety Compact",
        description:
          "Coordinate police, victim support, and prevention with transparent incident reporting.",
      },
      {
        title: "Focused Enforcement Partnerships",
        description: "Fund audited investigative partnerships aimed at repeat violent offending.",
      },
      {
        title: "Flexible Local Policing",
        description:
          "Give qualified forces operational flexibility with complaint review and due-process safeguards.",
      },
    ],
  },
  {
    familyId: "L35",
    levels: [
      {
        title: "Reentry and Diversion Network",
        description:
          "Provide broad local treatment, education, and housing support for eligible people leaving custody.",
      },
      {
        title: "High-Risk Reentry Support",
        description:
          "Target supervision and community placements to people with the greatest return-to-custody risk.",
      },
      {
        title: "Regional Diversion Compact",
        description:
          "Coordinate courts and services on lawful diversion and publish reoffending results.",
      },
      {
        title: "Outcome-Based Reentry",
        description:
          "Contract accredited reentry support against sustained housing and employment results.",
      },
      {
        title: "Flexible Community Corrections",
        description:
          "Expand lawful supervised alternatives with public safety and due-process reviews.",
      },
    ],
  },
  {
    familyId: "L36",
    levels: [
      {
        title: "Community Legal Access",
        description:
          "Fund broad legal help and interpretation for residents facing serious civil or criminal matters.",
      },
      {
        title: "Court Backlog Relief",
        description:
          "Target legal aid and scheduling support to jurisdictions with the longest verified delays.",
      },
      {
        title: "Local Justice Compact",
        description:
          "Coordinate court support, legal information, and public delay reporting under national procedure.",
      },
      {
        title: "Accredited Legal Services",
        description:
          "Buy qualified legal-aid capacity against audited case timeliness and client protection.",
      },
      {
        title: "Open Justice Services",
        description:
          "Allow more regulated legal-service providers while retaining independence and fair-hearing rules.",
      },
    ],
  },
  {
    familyId: "L37",
    levels: [
      {
        title: "Community Food Guarantee",
        description:
          "Fund broad school meals, food distribution, and local farm-to-market connections.",
      },
      {
        title: "Food Hardship Fund",
        description:
          "Target nutrition aid and supply links to households with verified food insecurity.",
      },
      {
        title: "Regional Food Compact",
        description:
          "Coordinate farms, schools, and emergency stores with transparent nutrition outcomes.",
      },
      {
        title: "Portable Food Assistance",
        description:
          "Give means-tested support redeemable at qualified sellers and audit access gaps.",
      },
      {
        title: "Open Food Supply Network",
        description:
          "Ease local market entry and distribution while keeping food safety and emergency reserves.",
      },
    ],
  },
  {
    familyId: "L38",
    levels: [
      {
        title: "Public Childcare Places",
        description:
          "Build affordable public childcare places and support parents returning to work.",
      },
      {
        title: "Childcare Gap Grants",
        description:
          "Target places and fee relief to low-access districts and lower-income families.",
      },
      {
        title: "Family Care Compact",
        description:
          "Coordinate a basic childcare floor with local provider choice and safety inspection.",
      },
      {
        title: "Portable Childcare Aid",
        description:
          "Fund means-tested childcare support at licensed providers with attendance audits.",
      },
      {
        title: "Open Childcare Places",
        description:
          "Ease qualified provider entry and flexible hours while enforcing child safety.",
      },
    ],
  },
  {
    familyId: "L39",
    levels: [
      {
        title: "Newcomer Welcome Network",
        description: "Fund broad language, school, and employment navigation for lawful newcomers.",
      },
      {
        title: "High-Need Integration Fund",
        description:
          "Target language and housing support to districts with the greatest service gaps.",
      },
      {
        title: "Local Integration Compact",
        description:
          "Coordinate schools, employers, and community groups within national entry law.",
      },
      {
        title: "Outcome-Based Welcome Services",
        description:
          "Contract qualified language and placement services against measured participation.",
      },
      {
        title: "Open Newcomer Employment",
        description:
          "Remove unnecessary local credential barriers while preserving lawful status checks.",
      },
    ],
  },
  {
    familyId: "L40",
    levels: [
      {
        title: "Equal Opportunity Service",
        description:
          "Fund broad access to training, legal support, and fair public-service delivery.",
      },
      {
        title: "Opportunity Gap Grants",
        description: "Target education and employment support where measured access gaps persist.",
      },
      {
        title: "Regional Fair Access Compact",
        description:
          "Audit public-service reach and fund practical remedies for verified barriers.",
      },
      {
        title: "Portable Opportunity Grants",
        description:
          "Let eligible residents choose approved training and support providers with outcome audits.",
      },
      {
        title: "Open Pathways Initiative",
        description:
          "Remove unnecessary local entry rules and enforce existing anti-discrimination law.",
      },
    ],
  },
  {
    familyId: "L41",
    levels: [
      {
        title: "Public Community Centers",
        description:
          "Fund accessible local gathering places, volunteer coordination, and civic education.",
      },
      {
        title: "Civic Participation Grants",
        description: "Target meeting space and volunteer support to low-participation communities.",
      },
      {
        title: "Community Partnership Compact",
        description:
          "Provide shared facilities and transparent small grants to independent civic groups.",
      },
      {
        title: "Competitive Civic Projects",
        description:
          "Award audited, time-limited grants for measurable local participation projects.",
      },
      {
        title: "Open Civic Spaces",
        description:
          "Ease lawful use of public spaces and permits while keeping safety and equal-access rules.",
      },
    ],
  },
  {
    familyId: "L42",
    levels: [
      {
        title: "Regional Renewal Mission",
        description:
          "Build public services and economic anchors in depopulating or distressed towns.",
      },
      {
        title: "At-Risk Town Fund",
        description:
          "Target housing, transport, and job supports to places with persistent population loss.",
      },
      {
        title: "Population Adaptation Compact",
        description:
          "Coordinate service consolidation and local opportunity with published migration trends.",
      },
      {
        title: "Investment-Led Renewal",
        description:
          "Offer audited site and workforce support for employers locating in shrinking districts.",
      },
      {
        title: "Open Renewal Zones",
        description:
          "Simplify reuse of vacant land and premises while preserving essential public services.",
      },
    ],
  },
  {
    familyId: "L43",
    levels: [
      {
        title: "Universal Local Voting Access",
        description:
          "Fund broad polling, accessibility, and voter information within national election law.",
      },
      {
        title: "Underserved Voter Access",
        description:
          "Target polling places and nonpartisan assistance where eligible turnout is lowest.",
      },
      {
        title: "Reliable Election Administration",
        description:
          "Maintain accessible local polls, transparent counts, and audited registration service.",
      },
      {
        title: "Efficient Polling Operations",
        description: "Consolidate low-use sites only with tested travel and queue safeguards.",
      },
      {
        title: "Flexible Voting Services",
        description:
          "Allow approved low-cost voting service formats while maintaining audit and equal access.",
      },
    ],
  },
  {
    familyId: "L44",
    levels: [
      {
        title: "Open Local Records Service",
        description:
          "Fund broad access to records, searchable notices, and staffed public assistance.",
      },
      {
        title: "High-Value Records Release",
        description:
          "Prioritize procurement and service records with the greatest public accountability value.",
      },
      {
        title: "Timely Records Compact",
        description:
          "Set published response times and a consistent appeals path for lawful records requests.",
      },
      {
        title: "Digital Records Efficiency",
        description:
          "Standardize reusable records and audit turnaround without exposing protected personal data.",
      },
      {
        title: "Open Information by Default",
        description:
          "Publish safe routine records proactively while retaining privacy and security exemptions.",
      },
    ],
  },
  {
    familyId: "L45",
    levels: [
      {
        title: "Public Integrity Office",
        description:
          "Fund independent local contract review, complaint intake, and disclosure enforcement.",
      },
      {
        title: "High-Risk Procurement Audit",
        description: "Concentrate checks on large awards and conflicts with clear referral rules.",
      },
      {
        title: "Integrity and Audit Compact",
        description:
          "Publish conflicts, bid outcomes, and routine audit findings under national law.",
      },
      {
        title: "Risk-Based Contract Checks",
        description:
          "Use targeted independent reviews of flagged awards instead of uniform paperwork.",
      },
      {
        title: "Open Competitive Procurement",
        description:
          "Simplify bidding while maintaining conflict disclosure, appeal rights, and fraud penalties.",
      },
    ],
  },
  {
    familyId: "L46",
    levels: [
      {
        title: "Community Rights Service",
        description:
          "Fund broad legal information, privacy support, and remedies for unlawful local action.",
      },
      {
        title: "Rights Complaint Support",
        description: "Target independent advice where access to local remedies is weakest.",
      },
      {
        title: "Fair Process Compact",
        description:
          "Require clear local notices and review of privacy and due-process complaints.",
      },
      {
        title: "Focused Privacy Review",
        description:
          "Audit high-risk local data uses while keeping lawful public services workable.",
      },
      {
        title: "Minimal Local Data Burden",
        description:
          "Limit unnecessary local data collection and preserve independent complaint review.",
      },
    ],
  },
  {
    familyId: "L47",
    levels: [
      {
        title: "Public Information Access",
        description:
          "Fund broad independent local news access and practical media-literacy services.",
      },
      {
        title: "Low-Access Media Grants",
        description:
          "Target nonpartisan information access where residents lack reliable local coverage.",
      },
      {
        title: "Information Integrity Compact",
        description:
          "Publish official records promptly and support independent verification without editorial control.",
      },
      {
        title: "Competitive Literacy Projects",
        description:
          "Tender time-limited media-literacy services with independence and results audits.",
      },
      {
        title: "Open Local Media Entry",
        description:
          "Ease lawful distribution and public-record access for diverse independent outlets.",
      },
    ],
  },
  {
    familyId: "L50",
    countries: ["US"],
    levels: [
      {
        title: "Comprehensive Firearms Licensing",
        description:
          "Require broad state training, purchase checks, and safe storage with review and appeal rights.",
      },
      {
        title: "Targeted Firearm Safety",
        description:
          "Focus state checks and safety training on verified risks while protecting lawful ownership.",
      },
      {
        title: "State Firearms Safety Compact",
        description:
          "Maintain a clear lawful ownership path with consistent checks and published injury data.",
      },
      {
        title: "Streamlined Lawful Carry",
        description:
          "Simplify qualified carry permits while retaining disqualifier checks and safety enforcement.",
      },
      {
        title: "Broad Firearm Access",
        description:
          "Remove discretionary state ownership barriers while preserving federal prohibitions and due process.",
      },
    ],
  },
  {
    familyId: "L51",
    countries: ["US"],
    levels: [
      {
        title: "Comprehensive Reproductive Access",
        description:
          "Fund broad lawful reproductive care and travel access with clinical privacy protections.",
      },
      {
        title: "Targeted Reproductive Care",
        description:
          "Expand verified gaps in contraception and pregnancy care with patient confidentiality.",
      },
      {
        title: "State Reproductive Care Compact",
        description:
          "Keep lawful core pregnancy care with clear clinical rules, referrals, and emergency protections.",
      },
      {
        title: "Restrictive Clinical Exceptions",
        description:
          "Limit elective procedures while funding defined clinical exceptions and timely review.",
      },
      {
        title: "Strict Procedure Limits",
        description:
          "Apply broad lawful state restrictions with emergency care and constitutional review safeguards.",
      },
    ],
  },
];

const positions: readonly LegislativePosition[] = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
];

const regionalPresentation: Readonly<
  Record<
    ResetCountry,
    {
      titlePrefix: string;
      authorityNote: string;
      authorityKind: RegionalLawLevel["authorityKind"];
    }
  >
> = {
  US: {
    titlePrefix: "State",
    authorityNote: "State law sets the program and the state budget funds delivery.",
    authorityKind: "state_statute",
  },
  UK: {
    titlePrefix: "Local Authority",
    authorityNote:
      "Local authorities deliver this service within national law and their allocated budget.",
    authorityKind: "delegated_service_package",
  },
  JP: {
    titlePrefix: "Regional",
    authorityNote:
      "Prefectural services coordinate inside the game's eight regional aggregates and use the regional budget.",
    authorityKind: "delegated_service_package",
  },
  IE: {
    titlePrefix: "Local Authority",
    authorityNote:
      "Local authorities deliver this service within national law and their allocated budget.",
    authorityKind: "delegated_service_package",
  },
  SCO: {
    titlePrefix: "Council",
    authorityNote:
      "Scottish councils deliver this service within national law and their allocated budget.",
    authorityKind: "delegated_service_package",
  },
  WAL: {
    titlePrefix: "Council",
    authorityNote:
      "Welsh councils deliver this service within national law and their allocated budget.",
    authorityKind: "delegated_service_package",
  },
};

const authoredRegionalLevels: readonly RegionalLawLevel[] = localRoutes.flatMap((route) =>
  (route.countries ?? (["US", "UK", "JP", "IE", "SCO", "WAL"] as const)).flatMap((country) =>
    route.levels.map((level, index) => ({
      familyId: route.familyId,
      country,
      position: positions[index]!,
      title: `${regionalPresentation[country].titlePrefix} ${level.title}`,
      description: `${level.description} ${regionalPresentation[country].authorityNote}`,
      authorityKind: regionalPresentation[country].authorityKind,
      fundingAccount: "regional_budget" as const,
      sourceAnchor: `1991 reset crosswalk: ${country}:regional:${route.familyId}`,
    }))
  )
);

const localizedPublicHealthLevels: readonly RegionalLawLevel[] = (
  ["IE", "SCO", "WAL"] as const
).flatMap((country) =>
  [
    [
      "Community Health Guarantee",
      "Fund a broad local clinic, vaccination, and surveillance network with clear delivery targets.",
    ],
    [
      "Prevention Gap Fund",
      "Expand targeted community outreach and disease reporting where coverage and staffing lag.",
    ],
    [
      "Public Health Partnership",
      "Maintain core public-health services while funding audited gap-filling partnerships.",
    ],
    [
      "Targeted Prevention Plan",
      "Commission risk-targeted outreach from eligible providers and monitor delivery within national law.",
    ],
    [
      "Flexible Prevention Network",
      "Use qualified public and private local providers while preserving public reporting duties.",
    ],
  ].map(([title, description], index) => ({
    familyId: "L19",
    country,
    position: positions[index]!,
    title: `${regionalPresentation[country].titlePrefix} ${title}`,
    description: `${description} ${regionalPresentation[country].authorityNote}`,
    authorityKind: regionalPresentation[country].authorityKind,
    fundingAccount: "regional_budget" as const,
    sourceAnchor: `1991 reset crosswalk: ${country}:regional:L19`,
  }))
);

export const regionalLawLevels: readonly RegionalLawLevel[] = [
  {
    familyId: "L19",
    country: "US",
    position: "far_left",
    title: "State Community Health Guarantee",
    description:
      "Fund a broad state clinic, vaccination, and surveillance network with local delivery targets.",
    authorityKind: "state_statute",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_US,
  },
  {
    familyId: "L19",
    country: "US",
    position: "center_left",
    title: "State Prevention Gap Fund",
    description:
      "Expand targeted county outreach and disease reporting where coverage and staffing lag.",
    authorityKind: "state_statute",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_US,
  },
  {
    familyId: "L19",
    country: "US",
    position: "center",
    title: "State Health Partnership",
    description:
      "Keep core state and county health services while funding audited gap-filling partnerships.",
    authorityKind: "state_statute",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_US,
  },
  {
    familyId: "L19",
    country: "US",
    position: "center_right",
    title: "Targeted State Prevention Contracts",
    description:
      "Concentrate state funds on measurable risks and contract eligible local providers.",
    authorityKind: "state_statute",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_US,
  },
  {
    familyId: "L19",
    country: "US",
    position: "far_right",
    title: "State Open Delivery Network",
    description:
      "Broaden qualified private delivery while retaining state reporting and emergency coordination.",
    authorityKind: "state_statute",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_US,
  },
  {
    familyId: "L19",
    country: "UK",
    position: "far_left",
    title: "District Prevention Service Expansion",
    description:
      "Use the regional service envelope for broad district outreach and prevention staffing under national NHS law.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_UK,
  },
  {
    familyId: "L19",
    country: "UK",
    position: "center_left",
    title: "Underserved District Outreach Plan",
    description:
      "Target regional prevention teams and clinics at documented coverage gaps within NHS authority.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_UK,
  },
  {
    familyId: "L19",
    country: "UK",
    position: "center",
    title: "Health Authority Prevention Compact",
    description:
      "Maintain core surveillance and district outreach with audited service partnerships.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_UK,
  },
  {
    familyId: "L19",
    country: "UK",
    position: "center_right",
    title: "District Risk Contract Plan",
    description:
      "Commission risk-targeted outreach from eligible providers and monitor delivery within national law.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_UK,
  },
  {
    familyId: "L19",
    country: "UK",
    position: "far_right",
    title: "Regional Provider Coordination Plan",
    description:
      "Favor flexible provider contracts while preserving statutory surveillance and emergency duties.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_UK,
  },
  {
    familyId: "L19",
    country: "JP",
    position: "far_left",
    title: "Prefectural Health-Center Expansion",
    description:
      "Coordinate broad prefectural health-center staffing and municipal prevention outreach across the aggregate.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_JP,
  },
  {
    familyId: "L19",
    country: "JP",
    position: "center_left",
    title: "Community Prevention Gap Program",
    description:
      "Fund additional prefectural and municipal outreach where documented prevention capacity is thin.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_JP,
  },
  {
    familyId: "L19",
    country: "JP",
    position: "center",
    title: "Prefectural Health Coordination",
    description:
      "Maintain health-center surveillance and municipal prevention service coordination under national law.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_JP,
  },
  {
    familyId: "L19",
    country: "JP",
    position: "center_right",
    title: "Targeted Prefectural Outreach",
    description:
      "Prioritize high-risk local outreach and accountable provider partnerships within prefectural competence.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_JP,
  },
  {
    familyId: "L19",
    country: "JP",
    position: "far_right",
    title: "Flexible Local Prevention Network",
    description:
      "Use qualified public and private local providers while preserving prefectural reporting duties.",
    authorityKind: "delegated_service_package",
    fundingAccount: "regional_budget",
    sourceAnchor: SOURCE_JP,
  },
  ...localizedPublicHealthLevels,
  ...authoredRegionalLevels,
];

export function regionalLawLevel(
  country: ResetCountry,
  familyId: string,
  position: LegislativePosition
): RegionalLawLevel | undefined {
  return regionalLawLevels.find(
    (level) =>
      level.country === country && level.familyId === familyId && level.position === position
  );
}
