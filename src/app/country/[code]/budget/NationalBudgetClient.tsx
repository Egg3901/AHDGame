"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { TreasuryMasthead, type BudgetLens } from "@/components/budget/treasury/TreasuryMasthead";
import { FiscalStatStrip } from "@/components/budget/treasury/FiscalStatStrip";
import { FiscalFlow } from "@/components/budget/treasury/FiscalFlow";
import {
  BudgetBreakdownPanel,
  type BreakdownLine,
} from "@/components/budget/treasury/BudgetBreakdownPanel";
import { DebtCreditPanel } from "@/components/budget/treasury/DebtCreditPanel";
import { EconomicIndicators } from "@/components/budget/treasury/EconomicIndicators";
import { SovereignHealthPanel } from "@/components/budget/treasury/SovereignHealthPanel";
import { GrantsPanel } from "@/components/budget/treasury/GrantsPanel";
import { MinisterCallouts } from "@/components/budget/treasury/MinisterCallouts";
import { PlannedEconomyPanel } from "@/components/economy/PlannedEconomyPanel";
import { Button, Skeleton, CardSkeleton, StatGridSkeleton, ListRowSkeleton } from "@/components/ui";
import type { FederalBudget, EnactedLaw } from "@/lib/db/types/budget";
import type {
  FyHistoryPoint,
  SovereignProjection,
} from "@/lib/publicFinance/queries/federalBudgetDetail";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { concentrationStatus } from "@/lib/nationalization/concentrationStatus";
import { getTreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import { budgetUsdEquivalent } from "@/lib/currency/budgetUsdEquivalent";
import { currencySymbolSep } from "@/lib/currency/symbolSep";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { budgetApiUrl } from "@/lib/urls";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";

interface SnapshotLaw {
  title: string;
  budgetCategory: string;
  costModel: string;
  enactedYear: number;
}

interface BudgetData {
  budget: FederalBudget;
  primeRate: number;
  turnsUntilFY: number;
  stateGrantBreakdown: { stateId: string; stateName: string; federalGrants: number }[];
  enactedLaws: EnactedLaw[] | SnapshotLaw[];
  grantLabel: string;
  grantRecipientLabel: string;
  isSnapshot?: boolean;
  snapshotFiscalYear?: number;
  availableFiscalYears?: number[];
  /** Signed per-turn State-enterprise net (local currency; +revenue / −expenditure; live budget only). */
  stateEnterpriseNet?: number;
  /** State Ownership Concentration Index (SOCI, 0–100) — state share of national corporate revenue. */
  stateOwnershipConcentration?: number;
  /** Signed national treasury balance (local currency); negative = national debt. */
  treasuryReserve?: number;
  /** Live national GDP in base currency units, summed from every region this
   *  turn. `budget.gdp` is the fiscal-close snapshot and lags this. */
  liveGdpUnits?: number;
  /** FY trend series (stat-strip compare + debt sparkline). */
  fyHistory?: FyHistoryPoint[];
  /** Live sovereign-default signals (Sovereign Health panel). */
  sovereign?: SovereignProjection;
  /** True when the viewer is the seated finance minister (Minister lens gate). */
  isFinanceMinister?: boolean;
  /** Calendar year for planned-economy regime banding. */
  currentYear?: number | null;
  /** GameConfig.commandEconomyEnabled. */
  commandEconomyEnabled?: boolean;
}

const REVENUE_TO_TAX_BASE: Record<string, string> = {
  incomeTax: "taxableIncome",
  domesticCorporateTax: "domesticCorporateProfits",
  foreignCorporateTax: "foreignCorporateProfits",
  payrollTax: "wagesAndSalaries",
  tariffs: "importValue",
  salesTax: "taxableSales",
};

const COUNTRY_LABELS = {
  US: {
    title: "Federal Budget",
    subtitle: "United States Federal Finances",
    debtTitle: "National Debt",
    ceilingLabel: "Debt Ceiling",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Spending by Category",
    revenueLabels: {
      incomeTax: "Income Tax",
      domesticCorporateTax: "Corporate Tax — Domestic",
      foreignCorporateTax: "Corporate Tax — Foreign",
      payrollTax: "Payroll Tax",
      tariffs: "Tariffs",
      salesTax: "Sales Tax",
      healthcareIncome: "Healthcare Income",
      other: "Other Revenue",
    },
    revenueDescriptions: {
      incomeTax: "Taxes on personal income and capital income reported by households.",
      domesticCorporateTax: "Taxes on profits of corporations headquartered in the United States.",
      foreignCorporateTax:
        "Taxes on profits earned in the United States by corporations headquartered abroad.",
      payrollTax: "Dedicated payroll contributions that finance social insurance programs.",
      tariffs: "Import duties and related border charges on traded goods.",
      salesTax: "National consumption tax receipts from taxable purchases.",
      healthcareIncome:
        "Operating receipts flowing back to the public budget from nationally run healthcare services and related public health activity.",
      other: "Residual receipts such as fees, remittances, and miscellaneous non-tax income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Wages & Salaries",
      tariffs: "Import Value",
      salesTax: "Taxable Sales",
    },
    spendingLabels: {
      healthcare: "Healthcare",
      defense: "Defense",
      socialSecurity: "Social Security",
      education: "Education",
      infrastructure: "Infrastructure",
      other: "Other",
    },
    spendingDescriptions: {
      healthcare:
        "Federal healthcare outlays such as Medicare, Medicaid, ACA subsidies, and public health programs.",
      defense: "Military operations, procurement, readiness, and long-term defense commitments.",
      socialSecurity:
        "Retirement and disability insurance obligations paid through federal social insurance.",
      education:
        "Federal education grants, student aid, special education support, and research commitments.",
      infrastructure:
        "Transportation, broadband, utilities, and other long-lived public capital projects.",
      other:
        "All remaining discretionary and mandatory programs not shown in the main named lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription:
      "Interest paid to service outstanding federal debt. This is driven by principal and rates rather than annual appropriations alone.",
    grantDescription:
      "Transfers to states through formula programs and other intergovernmental support channels.",
    activeLawsTitle: "Active Fiscal Laws",
  },
  UK: {
    title: "HM Treasury Budget",
    subtitle: "United Kingdom Public Finances",
    debtTitle: "Public Debt",
    ceilingLabel: "Borrowing Limit",
    revenueTitle: "Receipts",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Income Tax",
      domesticCorporateTax: "Corporation Tax — Domestic",
      foreignCorporateTax: "Corporation Tax — Foreign",
      payrollTax: "National Insurance",
      tariffs: "Duties & Customs",
      salesTax: "VAT",
      healthcareIncome: "Healthcare Income",
      other: "Other Receipts",
    },
    revenueDescriptions: {
      incomeTax: "Taxes on household earnings and taxable personal income.",
      domesticCorporateTax:
        "Taxes on profits of companies headquartered in the UK under the corporation tax regime.",
      foreignCorporateTax:
        "Taxes on profits earned in the UK by foreign-headquartered corporations.",
      payrollTax: "National Insurance contributions from workers and employers.",
      tariffs: "Customs, excise, and border-related indirect tax receipts.",
      salesTax: "Value Added Tax receipts from taxable consumption.",
      healthcareIncome:
        "Receipts attributed to the nationalized healthcare system, treated as public-sector operating income in the seeded UK fiscal baseline.",
      other: "Residual receipts such as fees, remittances, and other non-modelled revenues.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "NICs Earnings Base",
      tariffs: "Dutiable Trade Base",
      salesTax: "VATable Consumption",
    },
    spendingLabels: {
      health: "Health / NHS",
      education: "Education",
      statePensions: "State Pensions",
      welfare: "Welfare & UC",
      defense: "Defence",
      transport: "Transport",
      localGovernment: "Local Government",
      other: "Other Spending",
    },
    spendingDescriptions: {
      health:
        "HM Treasury support for the NHS and broader health services across the UK public sector.",
      education:
        "Schools, further education, skills policy, and other education spending commitments.",
      statePensions:
        "State pension obligations and pensioner support that rise with the covered population.",
      welfare:
        "Universal Credit and wider welfare spending on working-age support and safety-net programs.",
      defense:
        "Defence spending including readiness, procurement, and strategic commitments such as Trident.",
      transport:
        "Rail, roads, and major infrastructure commitments including long-term capital projects.",
      localGovernment:
        "Support for councils, local services, and place-based investment or levelling-up programs.",
      other:
        "All remaining departmental and annually managed expenditure outside the named headline lines.",
    },
    debtServiceLabel: "Debt Interest",
    debtServiceDescription:
      "Interest on outstanding public debt, shaped by the debt stock and prevailing gilt yields.",
    grantDescription:
      "Treasury transfers to devolved governments and regional bodies, including block-grant style support.",
    activeLawsTitle: "Active Treasury Measures",
  },
  JP: {
    title: "National Budget",
    subtitle: "Japan Public Finances",
    debtTitle: "National Debt",
    ceilingLabel: "Debt Ceiling",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Income Tax",
      domesticCorporateTax: "Corporate Tax — Domestic",
      foreignCorporateTax: "Corporate Tax — Foreign",
      payrollTax: "Social Insurance",
      tariffs: "Customs & Duties",
      salesTax: "Consumption Tax",
      healthcareIncome: "Healthcare Income",
      other: "Other Revenue",
    },
    revenueDescriptions: {
      incomeTax:
        "Taxes on personal income from wages, capital gains, and other household earnings.",
      domesticCorporateTax:
        "Taxes on profits of corporations headquartered in Japan under the corporate tax regime.",
      foreignCorporateTax:
        "Taxes on profits earned in Japan by foreign-headquartered corporations.",
      payrollTax:
        "Social insurance premiums funding pensions, healthcare, and employment insurance.",
      tariffs: "Customs duties and border-related charges on imported goods.",
      salesTax: "Consumption tax receipts from taxable goods and services.",
      healthcareIncome:
        "Operating receipts from public healthcare services and the national health insurance system.",
      other: "Residual receipts including fees, fines, and non-tax government income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Social Insurance Base",
      tariffs: "Import Value",
      salesTax: "Taxable Consumption",
    },
    spendingLabels: {
      health: "Healthcare",
      education: "Education",
      statePensions: "Pensions",
      welfare: "Social Welfare",
      defense: "Defense",
      infrastructure: "Public Works",
      other: "Other Spending",
    },
    spendingDescriptions: {
      health: "National health insurance subsidies and public health services.",
      education: "Schools, universities, research grants, and educational support programs.",
      statePensions: "National pension obligations driven by Japan's aging population.",
      welfare: "Social welfare programs, livelihood protection, and community support.",
      defense: "Self-Defense Forces operations, procurement, and readiness.",
      infrastructure: "Roads, railways, disaster prevention, and public capital investment.",
      other: "All remaining general expenditure not captured in named spending lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription:
      "Interest payments on outstanding government bonds. Japan carries the highest debt-to-GDP ratio among major economies.",
    grantDescription:
      "Central government transfers to prefectural and municipal governments through the Local Allocation Tax and specific grants.",
    activeLawsTitle: "Active Fiscal Legislation",
  },
  CA: {
    title: "Federal Budget",
    subtitle: "Canada Federal Finances",
    debtTitle: "Federal Debt",
    ceilingLabel: "Debt Limit",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Personal Income Tax",
      domesticCorporateTax: "Corporate Income Tax — Domestic",
      foreignCorporateTax: "Corporate Income Tax — Foreign",
      payrollTax: "EI & CPP Premiums",
      tariffs: "Customs & Duties",
      salesTax: "GST/HST",
      healthcareIncome: "Healthcare Income",
      other: "Other Revenue",
    },
    revenueDescriptions: {
      incomeTax: "Taxes on personal income from employment, investments, and other sources.",
      domesticCorporateTax:
        "Taxes on profits of domestic-headquartered corporations under the federal corporate income tax.",
      foreignCorporateTax:
        "Taxes on profits earned in-country by foreign-headquartered corporations.",
      payrollTax:
        "Employment Insurance and Canada Pension Plan premiums from workers and employers.",
      tariffs: "Customs duties on imported goods.",
      salesTax: "Goods and Services Tax / Harmonized Sales Tax receipts.",
      healthcareIncome: "Federal healthcare-related operating receipts.",
      other: "Other federal revenue including Crown corporation profits and fees.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Insurable Earnings",
      tariffs: "Import Value",
      salesTax: "Taxable Sales",
    },
    spendingLabels: {
      health: "Health Transfers",
      education: "Education",
      statePensions: "Elderly Benefits",
      welfare: "Social Programs",
      defense: "National Defence",
      infrastructure: "Infrastructure",
      other: "Other Spending",
    },
    spendingDescriptions: {
      health: "Canada Health Transfer and other federal health spending commitments.",
      education: "Federal support for post-secondary education and training programs.",
      statePensions:
        "Old Age Security, Guaranteed Income Supplement, and related elderly benefits.",
      welfare: "Employment Insurance benefits, child benefits, and social assistance transfers.",
      defense: "Canadian Armed Forces operations, procurement, and readiness.",
      infrastructure: "Federal infrastructure investment and transfers to provinces.",
      other: "All remaining federal program spending not captured in named lines.",
    },
    debtServiceLabel: "Public Debt Charges",
    debtServiceDescription:
      "Interest on outstanding federal debt obligations including bonds and treasury bills.",
    grantDescription:
      "Federal transfers to provinces and territories including equalization, health, and social transfers.",
    activeLawsTitle: "Active Federal Measures",
  },
  DE: {
    title: "Bundeshaushalt",
    subtitle: "Germany Federal Finances",
    debtTitle: "Federal Debt",
    ceilingLabel: "Debt Brake Limit",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Income Tax",
      solidaritySurcharge: "Solidaritätszuschlag (Soli)",
      domesticCorporateTax: "Corporate Tax — Domestic",
      foreignCorporateTax: "Corporate Tax — Foreign",
      payrollTax: "Social Contributions",
      tariffs: "Customs & EU Levies",
      salesTax: "VAT",
      healthcareIncome: "Healthcare Income",
      other: "Other Revenue",
    },
    revenueDescriptions: {
      incomeTax: "Taxes on personal income including wages and capital gains.",
      solidaritySurcharge:
        "Surcharge on income tax owed. Historically funded Aufbau Ost; feeds the general federal budget.",
      domesticCorporateTax:
        "Corporate income tax and trade tax receipts from German-headquartered companies.",
      foreignCorporateTax:
        "Corporate income tax receipts from foreign-headquartered companies operating in Germany.",
      payrollTax:
        "Mandatory social insurance contributions for health, pension, unemployment, and care.",
      tariffs: "Customs duties and EU-related border levies.",
      salesTax: "Value Added Tax receipts from taxable goods and services.",
      healthcareIncome: "Public health insurance system operating receipts.",
      other: "Other federal revenue including fees, fines, and asset income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Social Insurance Base",
      tariffs: "Import Value",
      salesTax: "Taxable Turnover",
    },
    spendingLabels: {
      health: "Healthcare",
      education: "Education & Research",
      statePensions: "Pensions",
      welfare: "Social Security",
      defense: "Defence",
      infrastructure: "Infrastructure",
      other: "Other Spending",
    },
    spendingDescriptions: {
      health: "Federal subsidies to statutory health insurance and public health programs.",
      education: "Federal education, research, and university funding commitments.",
      statePensions: "State pension contributions driven by Germany's aging demographic.",
      welfare: "Unemployment insurance, housing support, and social assistance programs.",
      defense: "Bundeswehr operations, procurement, and NATO commitments.",
      infrastructure: "Federal road, rail, and digital infrastructure investment.",
      other: "All remaining federal expenditure outside the named headline lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription:
      "Interest on outstanding federal debt, constrained by Germany's constitutional debt brake.",
    grantDescription:
      "Federal transfers to Länder through the fiscal equalization system and special-purpose grants.",
    activeLawsTitle: "Active Federal Legislation",
  },
  DD: {
    title: "Staatshaushaltsplan",
    subtitle: "East German State Finances",
    debtTitle: "State Debt",
    ceilingLabel: "Borrowing Limit",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Income Tax",
      domesticCorporateTax: "State Enterprise Levy",
      foreignCorporateTax: "Foreign Enterprise Levy",
      payrollTax: "Social Insurance Contributions",
      tariffs: "Customs and Bloc Trade Duties",
      salesTax: "Product-Related Levy",
      healthcareIncome: "Healthcare Income",
      other: "Other Revenue",
    },
    revenueDescriptions: {
      incomeTax: "Taxes on personal income including wages of workers and employees.",
      domesticCorporateTax:
        "Net-profit transfers from domestically owned people's enterprises and combines.",
      foreignCorporateTax:
        "Levies on foreign-headquartered enterprises operating inside the republic.",
      payrollTax:
        "Compulsory social insurance contributions for health, pension, and accident cover.",
      tariffs: "Customs duties and duties on trade with the socialist bloc and the West.",
      salesTax: "The product-related levy applied to consumer goods at planned retail prices.",
      healthcareIncome: "Operating receipts of the state health insurance system.",
      other: "Other state revenue including fees, fines, and asset income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Enterprise Profits",
      foreignCorporateTax: "Foreign Enterprise Profits",
      payrollTax: "Social Insurance Base",
      tariffs: "Import Value",
      salesTax: "Planned Retail Turnover",
    },
    spendingLabels: {
      health: "Healthcare",
      healthcare: "Healthcare",
      education: "Education and Science",
      statePensions: "Pensions",
      welfare: "Social Provision",
      socialSecurity: "Social Provision",
      defense: "Defence",
      infrastructure: "Infrastructure",
      other: "Other Spending",
    },
    spendingDescriptions: {
      health: "Polyclinics, hospitals, and the state health service.",
      healthcare: "Polyclinics, hospitals, and the state health service.",
      education: "Schools, universities, and state research institutes.",
      statePensions: "State old-age pensions paid through the social insurance system.",
      welfare: "Subsidies on rent and basic goods, plus family and social support.",
      socialSecurity: "Subsidies on rent and basic goods, plus family and social support.",
      defense: "National People's Army operations, procurement, and Warsaw Pact commitments.",
      infrastructure: "Rail, road, housing construction, and energy infrastructure investment.",
      other: "All remaining state expenditure outside the named headline lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription:
      "Interest on outstanding state debt, largely owed to bloc partners and Western creditors.",
    grantDescription:
      "State transfers to the Bezirke and Länder for local plans and special-purpose programmes.",
    activeLawsTitle: "Active State Legislation",
  },
  CN: {
    title: "国家预算 / National Budget",
    subtitle: "China Central Government Finances",
    debtTitle: "Central Government Debt",
    ceilingLabel: "Debt Service Ceiling",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Category",
    revenueLabels: {
      incomeTax: "Individual Income Tax (个人所得税)",
      domesticCorporateTax: "Enterprise Income Tax (企业所得税)",
      foreignCorporateTax: "Foreign Enterprise Tax",
      payrollTax: "Social Insurance (社会保险)",
      tariffs: "Customs Duties (关税)",
      salesTax: "Value-Added Tax (增值税)",
      landValueAddedTax: "Land Value-Added Tax (土地增值税)",
      urbanMaintenanceTax: "Urban Maintenance & Construction Tax (城市维护建设税)",
      stampDuty: "Stamp Duty (印花税)",
      healthcareIncome: "Health Insurance Income",
      other: "Other Central Revenue",
    },
    revenueDescriptions: {
      incomeTax: "Personal income tax (IIT) receipts under the 个人所得税 framework.",
      domesticCorporateTax:
        "Statutory enterprise income tax (EIT) receipts on domestic-corporate profits.",
      foreignCorporateTax:
        "EIT receipts from foreign-headquartered enterprises operating in China.",
      payrollTax:
        "Combined employer + employee 社会保险 contributions covering pension, medical, unemployment, work-injury, and maternity insurance.",
      tariffs: "Customs duties (关税) on imports under the WTO-bound tariff schedule.",
      salesTax: "Value-Added Tax receipts — China's largest single tax revenue line.",
      landValueAddedTax:
        "Capital-gains tax on real-estate transactions, with progressive rates from 30% to 60% on appreciation.",
      urbanMaintenanceTax:
        "Surcharge on VAT and Consumption Tax revenue, funding municipal infrastructure.",
      stampDuty:
        "Small-rate tax on documented transactions including securities trades, contracts, and property transfers.",
      healthcareIncome:
        "Operating receipts from state-funded hospital networks and public-health programs.",
      other: "Residual receipts including fees, transfers, and miscellaneous non-tax income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Wages & Salaries",
      tariffs: "Import Value",
      salesTax: "Taxable Sales",
    },
    spendingLabels: {
      socialSecurity: "Social Security",
      education: "Education",
      health: "Health & Medical",
      defense: "Defense",
      infrastructure: "Infrastructure",
      agriculture: "Agriculture & Rural Revitalization",
      other: "Other Central Expenditure",
    },
    spendingDescriptions: {
      socialSecurity: "Pension fund, social-insurance disbursements, and rural-pension subsidies.",
      education:
        "9-year compulsory education funding, higher education subsidies, and 双减 (Double Reduction) program implementation.",
      health: "医保 reimbursements, hospital network funding, and public-health infrastructure.",
      defense: "PLA modernization, force readiness, and overseas-power projection commitments.",
      infrastructure:
        "High-speed rail, digital infrastructure, urban transit, and 一带一路 (Belt and Road) capital outflows.",
      agriculture:
        "三农 (three rural) framework subsidies and 乡村振兴 (rural revitalization) funding.",
      other: "All remaining central-government programs not in the named lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription: "Interest paid to service outstanding central-government debt.",
    grantDescription:
      "Central-local fiscal-relationship transfers to provinces under the 央地财政关系 framework.",
    activeLawsTitle: "Active Fiscal Laws",
  },
  IE: {
    title: "National Budget",
    subtitle: "Government of Ireland Finances",
    debtTitle: "National Debt",
    ceilingLabel: "Debt-Service Ceiling",
    revenueTitle: "Revenue Sources",
    spendingTitle: "Expenditure by Vote",
    revenueLabels: {
      incomeTax: "Income Tax",
      domesticCorporateTax: "Corporation Tax (Domestic)",
      foreignCorporateTax: "Foreign Corporation Tax",
      payrollTax: "Pay-Related Social Insurance (PRSI)",
      tariffs: "Customs Duties",
      salesTax: "Value-Added Tax (VAT)",
      universalSocialCharge: "Universal Social Charge (USC)",
      capitalGainsTax: "Capital Gains Tax",
      exciseDuty: "Excise Duty",
      stampDuty: "Stamp Duty",
      propertyTax: "Local Property Tax (LPT)",
      healthcareIncome: "Health Service Income",
      other: "Other Receipts",
    },
    revenueDescriptions: {
      incomeTax:
        "Personal income-tax receipts under the 20% standard rate / 40% higher rate two-band structure.",
      domesticCorporateTax:
        "Corporation tax on Irish-headquartered companies — the 12.5% statutory rate has been the cornerstone of FDI policy since 1997.",
      foreignCorporateTax:
        "Corporation tax on foreign-headquartered multinationals operating in Ireland (subject to OECD Pillar Two 15% minimum effective rate).",
      payrollTax:
        "Combined employer + employee Pay-Related Social Insurance contributions funding the Social Insurance Fund.",
      tariffs:
        "Customs duties on third-country imports negotiated jointly under the EU Common External Tariff framework.",
      salesTax:
        "Value-Added Tax receipts — the 23% standard rate, 13.5% reduced for hospitality/construction, 9% second-reduced.",
      universalSocialCharge:
        "USC — separate levy on gross income above thresholds, introduced 2011 as a budget-emergency measure.",
      capitalGainsTax:
        "Tax on realized investment gains at the 33% statutory rate (one of the highest CGT rates in Europe).",
      exciseDuty:
        "Excise duties on alcohol, tobacco, and fuel — includes the scheduled carbon-tax pathway to €100/tonne by 2030.",
      stampDuty:
        "Stamp duty on property transfers (1% under €1M, 2% above) and share/securities trades (1%).",
      propertyTax:
        "Local Property Tax — Revenue Commissioners-administered annual charge at the 0.18% statutory rate on residential property valuations.",
      healthcareIncome: "Operating receipts from HSE-funded services and statutory health charges.",
      other: "Residual receipts including levies, fees, and non-tax income.",
    },
    taxBaseLabels: {
      incomeTax: "Taxable Income",
      domesticCorporateTax: "Domestic Corporate Profits",
      foreignCorporateTax: "Foreign Corporate Profits",
      payrollTax: "Wages & Salaries",
      tariffs: "Import Value",
      salesTax: "Taxable Consumer Spending",
    },
    spendingLabels: {
      socialProtection: "Social Protection",
      education: "Education",
      health: "Health",
      housing: "Housing & Local Government",
      transport: "Transport & Climate",
      defense: "Defence",
      other: "Other Departmental Spending",
    },
    spendingDescriptions: {
      socialProtection:
        "Contributory State Pension, Jobseeker's payments, Working Family Payment, and other Department of Social Protection schemes.",
      education:
        "Per-pupil capitation grants, DEIS programme, Free Fees / SUSI, and Higher Education Authority funding.",
      health:
        "HSE budget covering acute hospitals, primary care, community services, and the Sláintecare implementation programme.",
      housing:
        "Local Government Fund, Housing for All capital programme, LDA cost-rental schemes, AHB approval pathway.",
      transport:
        "National Transport Authority, BusConnects, MetroLink, Iarnród Éireann electrification, and Climate Action Plan capital.",
      defense: "Defence Forces operations (LOA 2 trajectory) and Naval Service patrol capacity.",
      other: "All remaining departmental expenditure not in the named lines.",
    },
    debtServiceLabel: "Debt Service",
    debtServiceDescription:
      "Interest paid on outstanding national debt, governed by the EU Stability and Growth Pact 3% deficit / 60% debt-to-GDP framework.",
    grantDescription:
      "Local Government Fund transfers to county and city councils, plus ringfenced regional grants.",
    activeLawsTitle: "Active Legislation",
  },
} as const;

function humanizeKey(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function getNumericField(record: unknown, key: string): number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

export function NationalBudgetClient() {
  const { code } = useParams<{ code: string }>();
  const { preset, loaded: worldFlagsLoaded } = useWorldFlags();
  const countryParam = code?.toUpperCase() as CountryId | undefined;
  const countryId: CountryId =
    countryParam && countryParam in COUNTRY_CONFIGS
      ? (countryParam as CountryId)
      : COUNTRY_CONFIGS.US.id;
  const config = getCountryConfig(countryId);

  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFY, setSelectedFY] = useState<number | null>(null);
  const [lens, setLens] = useState<BudgetLens>("public");
  const [compare, setCompare] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const url = selectedFY
      ? `${budgetApiUrl(countryId)}?fiscalYear=${selectedFY}`
      : budgetApiUrl(countryId);
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, selectedFY, reloadNonce]);

  const budgetCountryKey = (
    countryId in COUNTRY_LABELS ? countryId : COUNTRY_CONFIGS.US.id
  ) as keyof typeof COUNTRY_LABELS;
  const labels = COUNTRY_LABELS[budgetCountryKey];
  const moneyPrefix = getCurrencyPrefix(countryId, data?.budget.currencyCode);
  const isStaleCountryBudget =
    data?.budget?.countryId != null && data.budget.countryId !== countryId;

  const formatMoney = useMemo(() => {
    const sep = currencySymbolSep(moneyPrefix);
    return (n: number) => {
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      const body =
        abs >= 1e12
          ? `${(abs / 1e12).toFixed(1)}T`
          : abs >= 1e9
            ? `${(abs / 1e9).toFixed(1)}B`
            : `${(abs / 1e6).toFixed(1)}M`;
      return `${sign}${moneyPrefix}${sep}${body}`;
    };
  }, [moneyPrefix]);

  const formatUnitMoney = useMemo(() => {
    const sep = currencySymbolSep(moneyPrefix);
    return (n: number) =>
      `${moneyPrefix}${sep}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }, [moneyPrefix]);

  if (loading || isStaleCountryBudget) {
    return (
      <main className="min-h-screen bg-background pb-16">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
          {/* Treasury masthead — identity band + fiscal stat strip */}
          <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-6 w-56" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            </div>
            <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex min-w-max flex-col gap-1.5 px-5 py-3">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>

          {/* Fiscal flow */}
          <CardSkeleton className="min-h-[180px] space-y-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardSkeleton>

          {/* Revenue + spending breakdown panels */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {[0, 1].map((i) => (
              <CardSkeleton key={i} className="min-h-[320px]">
                <Skeleton className="h-4 w-44 mb-4" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <ListRowSkeleton key={j} lines={1} withBadge />
                ))}
              </CardSkeleton>
            ))}
          </div>

          {/* Debt & credit + economic indicators */}
          <div className="grid gap-6 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <CardSkeleton key={i} className="min-h-[220px]">
                <Skeleton className="h-4 w-40 mb-4" />
                <StatGridSkeleton cols={2} count={4} />
              </CardSkeleton>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-background pb-16">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="mb-4 text-muted">Failed to load budget data. Please try again.</p>
            <Button
              variant="primary"
              onClick={() => {
                setLoading(true);
                setReloadNonce((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const {
    budget,
    primeRate,
    turnsUntilFY,
    stateGrantBreakdown,
    enactedLaws,
    grantLabel,
    grantRecipientLabel,
  } = data;

  const describeLawCost = (law: EnactedLaw) => {
    // New-generation catalog laws price through costModelV2 (routed first,
    // like the cost engine) — without this branch every catalog law fell
    // through to the misleading "No direct fiscal delta" fallback.
    if (law.costModelV2) {
      const parts: string[] = [];
      if (law.costModelV2.gdpCostFraction) {
        parts.push(`${(law.costModelV2.gdpCostFraction * 100).toFixed(2)}% of GDP`);
      }
      if (law.costModelV2.incomeCostFraction) {
        parts.push(
          `${(law.costModelV2.incomeCostFraction * 100).toFixed(2)}% of avg income/person`
        );
      }
      if (law.costModelV2.gdpRevenueFraction) {
        parts.push(`+${(law.costModelV2.gdpRevenueFraction * 100).toFixed(2)}% of GDP revenue`);
      }
      // Level 0 (repealed) carries an empty model — fall through to the
      // no-delta label, which is accurate there.
      if (parts.length > 0) return parts.join(" · ");
    }
    if (law.gdpPerCapitaMultiplier !== undefined) {
      return `${(law.gdpPerCapitaMultiplier * 100).toFixed(2)}% of GDP`;
    }
    if (law.annualCostPerCapita !== undefined) {
      return `${formatUnitMoney(law.annualCostPerCapita)}/person`;
    }
    if (law.annualCostUsd !== undefined) {
      return formatMoney(law.annualCostUsd);
    }
    if (law.budgetCost !== 0) {
      return `${law.budgetCost.toFixed(1)}% of budget`;
    }
    return "No direct fiscal delta";
  };

  const formatLawCost = (law: EnactedLaw | SnapshotLaw): string =>
    "costModel" in law ? law.costModel : describeLawCost(law as EnactedLaw);

  // Structured revenue lines for the expandable breakdown panel (rate + base).
  const revenueLines: BreakdownLine[] = Object.entries(budget.revenue)
    .filter(([key]) => key !== "total")
    .map(([key, value]) => {
      const taxRate = getNumericField(budget.taxRates, key);
      const taxBaseField = REVENUE_TO_TAX_BASE[key];
      const storedTaxBase =
        taxBaseField && budget.taxBases
          ? (budget.taxBases as unknown as Record<string, number | undefined>)[taxBaseField]
          : undefined;
      const taxBase = storedTaxBase ?? (taxRate && taxRate > 0 ? value / (taxRate / 100) : 0);
      const hasBase =
        labels.taxBaseLabels[key as keyof typeof labels.taxBaseLabels] != null &&
        taxRate !== undefined;
      const label =
        labels.revenueLabels[key as keyof typeof labels.revenueLabels] ?? humanizeKey(key);
      return {
        id: key,
        label,
        description:
          labels.revenueDescriptions[key as keyof typeof labels.revenueDescriptions] ??
          `${label} receipts.`,
        amount: value,
        rate: taxRate ?? null,
        base: hasBase ? taxBase : null,
      };
    });

  // Statutory tax laws govern revenue, not spending: the API enriches each with
  // `revenueTaxType` (the FederalTaxRates key it sets). File them under the
  // matching revenue line as "Governing statutes" (rate already shown above).
  for (const law of enactedLaws) {
    const revenueTaxType = (law as { revenueTaxType?: string }).revenueTaxType;
    if (!revenueTaxType) continue;
    const line = revenueLines.find((l) => l.id === revenueTaxType);
    if (line) (line.laws ??= []).push({ title: law.title, cost: "", year: law.enactedYear });
  }

  // Structured spending lines (laws / grants / debt-service), plus the synthetic
  // grants + debt-service lines. "tax" is a revenue concept, not an expenditure —
  // skip it (statutory tax laws bucket a ¥0 entry there; they live on revenue).
  const spendingLines: BreakdownLine[] = [
    ...Object.entries(budget.spending.byCategory)
      .filter(([key]) => key !== "tax")
      .map(([key, value]) => {
        const label =
          labels.spendingLabels[key as keyof typeof labels.spendingLabels] ?? humanizeKey(key);
        return {
          id: key,
          label,
          description:
            labels.spendingDescriptions[key as keyof typeof labels.spendingDescriptions] ??
            `${label} spending.`,
          amount: value,
          laws: enactedLaws
            .filter((law) => law.budgetCategory === key)
            .map((law) => ({ title: law.title, cost: formatLawCost(law), year: law.enactedYear })),
        };
      }),
    {
      id: "stateGrants",
      label: grantLabel,
      description: labels.grantDescription,
      amount: budget.spending.stateGrants,
      grants: stateGrantBreakdown.map((g) => ({
        id: g.stateId,
        name: g.stateName,
        amount: g.federalGrants,
      })),
    },
    {
      id: "debtInterest",
      label: labels.debtServiceLabel,
      description: labels.debtServiceDescription,
      amount: budget.spending.debtInterest,
      isDebt: true,
    },
  ];

  // State Enterprises line: the National Corporations' net per-turn result, in
  // local currency. Positive ⇒ a Revenue Sources line; a loss ⇒ an Expenditure
  // line. Per-turn (excluded from the annual bar) since SOEs settle each turn.
  const soeNet = Math.round(data.stateEnterpriseNet ?? 0);
  const soeConcentration = concentrationStatus(data.stateOwnershipConcentration ?? 0);
  const soeConcentrationNote =
    soeConcentration.tier === "none"
      ? ""
      : ` State ownership: ${Math.round(data.stateOwnershipConcentration ?? 0)}% of national corporate revenue (${soeConcentration.label}).`;
  const soeLine = (amount: number): BreakdownLine => ({
    id: "stateEnterprises",
    label: "State Enterprises",
    description:
      "Net per-turn operating result of this country's National Corporations — remitted profit when in surplus, treasury-backed losses when in deficit." +
      soeConcentrationNote,
    amount,
    perTurn: true,
    soeLink: true,
  });
  const revenueLinesFinal = soeNet > 0 ? [...revenueLines, soeLine(soeNet)] : revenueLines;
  const spendingLinesFinal =
    soeNet < 0 ? [...spendingLines, soeLine(Math.abs(soeNet))] : spendingLines;

  const treasuryIdentity = getTreasuryIdentity(countryId);
  const fyHistory = data.fyHistory ?? [];
  const fyMin = fyHistory.length > 0 ? fyHistory[0].fy : budget.fiscalYear;
  const fyMax = fyHistory.length > 0 ? fyHistory[fyHistory.length - 1].fy : budget.fiscalYear;
  const isLive = !(data.isSnapshot ?? false);
  const prevFyPoint = fyHistory.find((p) => p.fy === budget.fiscalYear - 1) ?? null;
  const treasuryBalance = data.treasuryReserve ?? -(budget.debt?.principal ?? 0);
  // The `??` is load-bearing. `loadFederalBudgetDetail`'s historical-FY branch
  // returns early and never sets `liveGdpUnits`, so a snapshot view falls back
  // to that snapshot's own gdp rather than showing today's live figure. Do not
  // "simplify" this to `data.liveGdpUnits`.
  const displayGdp = data.liveGdpUnits ?? budget.gdp;
  // The minister lens is gated: a non-minister viewer (or a historical snapshot,
  // which never authorizes it) is always forced back to the Public lens. Derived
  // rather than reset via effect so toggling stays a pure render.
  const effectiveLens: BudgetLens = (data.isFinanceMinister ?? false) ? lens : "public";

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <TreasuryMasthead
          countryId={countryId}
          identity={treasuryIdentity}
          executiveLabel={config.executiveLabel}
          fiscalYear={budget.fiscalYear}
          fyMin={fyMin}
          fyMax={fyMax}
          setFy={(fy) => setSelectedFY(fy >= fyMax ? null : fy)}
          isLive={isLive}
          turnsUntilFY={turnsUntilFY}
          lens={effectiveLens}
          setLens={setLens}
          isFinanceMinister={data.isFinanceMinister ?? false}
          compare={compare}
          setCompare={setCompare}
          hasPrevFy={prevFyPoint != null}
          statStrip={
            <FiscalStatStrip
              sym={moneyPrefix}
              revenue={budget.revenue.total}
              spending={budget.spending.total}
              gdp={displayGdp}
              ratioGdp={resolveRatioGdp(budget)}
              gdpGrowth={budget.economicFactors.gdpGrowth}
              debtToGdp={budget.debtToGdpRatio}
              rating={budget.creditRating}
              treasuryReserve={treasuryBalance}
              compare={compare}
              prev={prevFyPoint}
              toUsd={
                worldFlagsLoaded ? (n) => budgetUsdEquivalent(n, countryId, preset) : undefined
              }
            />
          }
        />

        {!isLive && (
          <div className="flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
            <svg
              className="h-4 w-4 shrink-0 text-warning"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-body-sm text-foreground/85">
              Viewing the <span className="font-semibold text-warning">FY{budget.fiscalYear}</span>{" "}
              historical snapshot.
            </div>
          </div>
        )}

        {effectiveLens === "minister" && (
          <MinisterCallouts
            inputs={{
              sym: moneyPrefix,
              revenueTotal: budget.revenue.total,
              spendingTotal: budget.spending.total,
              // Ratio basis, not the display level: these flags compare against
              // deficit and debt thresholds, so they must sit on the same
              // denominator as the stored `debtToGdpRatio` in the strip above.
              gdp: resolveRatioGdp(budget),
              debtPrincipal: budget.debt.principal,
              debtCeiling: budget.debt.ceiling,
              ceilingLabel: labels.ceilingLabel,
              gdpGrowth: budget.economicFactors.gdpGrowth,
              inflationRate: budget.economicFactors.inflationRate ?? 0,
            }}
            subtitle={labels.subtitle}
            fiscalYear={budget.fiscalYear}
          />
        )}

        <FiscalFlow
          revenue={revenueLines.map((r) => ({ label: r.label, value: r.amount }))}
          spending={spendingLines.map((r) => ({ label: r.label, value: r.amount }))}
          revenueTotal={budget.revenue.total}
          spendingTotal={budget.spending.total}
          sym={moneyPrefix}
          fiscalYear={budget.fiscalYear}
          accent={treasuryIdentity.accent}
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <BudgetBreakdownPanel
            kind="revenue"
            title={labels.revenueTitle}
            lines={revenueLinesFinal}
            total={budget.revenue.total}
            sym={moneyPrefix}
            countryCode={countryId}
            grantRecipientLabel={grantRecipientLabel}
          />
          <BudgetBreakdownPanel
            kind="spending"
            title={labels.spendingTitle}
            lines={spendingLinesFinal}
            total={budget.spending.total}
            sym={moneyPrefix}
            countryCode={countryId}
            grantRecipientLabel={grantRecipientLabel}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DebtCreditPanel
            sym={moneyPrefix}
            principal={budget.debt.principal}
            interestRate={budget.debt.interestRate}
            ceiling={budget.debt.ceiling}
            ceilingLabel={labels.ceilingLabel}
            debtToGdp={budget.debtToGdpRatio}
            rating={budget.creditRating}
            trend={fyHistory.map((p) => p.debtToGdp * 100)}
            trendRange={
              fyHistory.length > 1
                ? `FY${fyHistory[0].fy}–FY${fyHistory[fyHistory.length - 1].fy}`
                : ""
            }
            compare={compare}
            prevDebtToGdp={prevFyPoint?.debtToGdp ?? null}
          />
          <EconomicIndicators
            countryId={countryId}
            inflationRate={budget.economicFactors.inflationRate ?? 0}
            gdpGrowth={budget.economicFactors.gdpGrowth}
            wageGrowth={budget.economicFactors.wageGrowth}
            primeRate={primeRate}
            deficitToGdp={
              resolveRatioGdp(budget) > 0
                ? (federalSurplus(budget) / resolveRatioGdp(budget)) * 100
                : 0
            }
          />
        </div>

        <PlannedEconomyPanel
          countryId={countryId}
          currentYear={data.currentYear}
          commandEconomyEnabled={data.commandEconomyEnabled}
          factors={budget.economicFactors}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          {isLive && data.sovereign && <SovereignHealthPanel sovereign={data.sovereign} />}
          <GrantsPanel
            title={grantLabel}
            recipientLabel={grantRecipientLabel}
            grants={stateGrantBreakdown.map((g) => ({
              id: g.stateId,
              name: g.stateName,
              amount: g.federalGrants,
            }))}
            total={budget.spending.stateGrants}
            sym={moneyPrefix}
          />
        </div>
      </div>
    </main>
  );
}
