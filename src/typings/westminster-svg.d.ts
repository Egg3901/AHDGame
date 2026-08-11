declare module "westminster-svg" {
  import type { Root } from "hast";

  type WestminsterSide = Record<string, { seats: number; colour: string }>;

  type Parliament = {
    headBench: WestminsterSide;
    left: WestminsterSide;
    right: WestminsterSide;
    crossBench: WestminsterSide;
  };

  function generate(parliament: Parliament, options?: { hFunction?: unknown }): Root;
  export default generate;
}
