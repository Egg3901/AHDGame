export interface LegislatureCommandResult<TBody extends object = Record<string, unknown>> {
  status: number;
  body: TBody;
}
