/**
 * Ireland Cabinet positions (Government of Ireland / Rialtas na hÉireann).
 *
 * The Taoiseach nominates ministers to the Government; the Uachtarán
 * formally appoints them on the Taoiseach's advice without a separate
 * Dáil confirmation vote. 19 positions = Taoiseach + Tánaiste + 17
 * ministers, matching the Government of Ireland as constituted under
 * the Ministers and Secretaries Acts.
 *
 * Position IDs lower-snake_case, prefixed with `minister_for_*` for the
 * 17 portfolio ministers; the two constitutional offices (Taoiseach,
 * Tánaiste) use bare keys. The Phase 1 IE country config's
 * `financeMinisterCabinetId: "minister_for_finance"` resolves against
 * this list.
 */
export const IE_CABINET_POSITIONS = [
  { id: "taoiseach", yearEnabled: 1775, name: "Taoiseach", order: 0, isHeadOfGovernment: true },
  { id: "tanaiste", yearEnabled: 1775, name: "Tánaiste", order: 1 },
  { id: "minister_for_finance", yearEnabled: 1775, name: "Minister for Finance", order: 2 },
  {
    id: "minister_for_public_expenditure",
    yearEnabled: 1775,
    name: "Minister for Public Expenditure, NDP Delivery and Reform",
    order: 3,
  },
  {
    id: "minister_for_foreign_affairs",
    yearEnabled: 1775,
    name: "Minister for Foreign Affairs",
    order: 4,
  },
  {
    id: "minister_for_enterprise",
    yearEnabled: 1775,
    name: "Minister for Enterprise, Trade and Employment",
    order: 5,
  },
  { id: "minister_for_health", yearEnabled: 1775, name: "Minister for Health", order: 6 },
  { id: "minister_for_education", yearEnabled: 1775, name: "Minister for Education", order: 7 },
  {
    id: "minister_for_further_higher_education",
    yearEnabled: 1775,
    name: "Minister for Further and Higher Education, Research, Innovation and Science",
    order: 8,
  },
  {
    id: "minister_for_housing",
    yearEnabled: 1775,
    name: "Minister for Housing, Local Government and Heritage",
    order: 9,
  },
  {
    id: "minister_for_social_protection",
    yearEnabled: 1775,
    name: "Minister for Social Protection",
    order: 10,
  },
  { id: "minister_for_justice", yearEnabled: 1775, name: "Minister for Justice", order: 11 },
  { id: "minister_for_defence", yearEnabled: 1775, name: "Minister for Defence", order: 12 },
  {
    id: "minister_for_environment_climate",
    yearEnabled: 1775,
    name: "Minister for the Environment, Climate and Communications",
    order: 13,
  },
  {
    id: "minister_for_agriculture",
    yearEnabled: 1775,
    name: "Minister for Agriculture, Food and the Marine",
    order: 14,
  },
  { id: "minister_for_transport", yearEnabled: 1775, name: "Minister for Transport", order: 15 },
  {
    id: "minister_for_tourism_culture",
    yearEnabled: 1775,
    name: "Minister for Tourism, Culture, Arts, Gaeltacht, Sport and Media",
    order: 16,
  },
  {
    id: "minister_for_children",
    yearEnabled: 1775,
    name: "Minister for Children, Equality, Disability, Integration and Youth",
    order: 17,
  },
  {
    id: "minister_for_rural_community",
    yearEnabled: 1775,
    name: "Minister for Rural and Community Development",
    order: 18,
  },
] as const;

export type IECabinetPositionId = (typeof IE_CABINET_POSITIONS)[number]["id"];
