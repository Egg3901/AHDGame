/** Routes exposed by the live Cold War command console. */
export const CW_ROUTES = {
  // built
  flashpoints: "/world/conflicts",
  blocs: "/world/conflicts/blocs",
  combat: "/world/conflicts/combat",
  situation: "/world/conflicts/situation",

  // paired command surfaces
  blocsEast: "/world/conflicts/blocs/east",
  orgs: "/world/conflicts/orgs",
  warsawPact: "/world/conflicts/warsaw-pact",
  // The mock alignment boards are retired; both routes redirect to the Cold War
  // Ledger, which reads real alignment for every nation.
  alignment: "/world/conflicts/alignment",
  activeMeasures: "/world/conflicts/active-measures",
  station: "/world/conflicts/station",
  kgb: "/world/conflicts/kgb",
  detente: "/world/conflicts/detente",
  detenteEast: "/world/conflicts/detente/east",
  crisis: "/world/conflicts/crisis",
  crisisEast: "/world/conflicts/crisis/east",
  homeFront: "/world/conflicts/home-front",
  politburo: "/world/conflicts/politburo",
} as const;
