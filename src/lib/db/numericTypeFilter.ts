import type { Condition } from "mongodb";

/**
 * `{ $type: "number" }` as a typed filter condition.
 *
 * MongoDB has accepted `"number"` since 3.2 as an alias matching every numeric
 * BSON type (int, long, double, decimal). The Node driver's TypeScript
 * `BSONType` union does not list it, and it does not accept the equivalent
 * array form `["int", "long", "double", "decimal"]` in this position either, so
 * a correct query fails to compile.
 *
 * The cast is deliberately isolated here rather than repeated at each call
 * site: the runtime filter is unchanged and provably correct against the
 * server, and only the driver's type needs persuading. If the driver ever adds
 * `"number"` to its union, deleting this file and inlining the literal is the
 * whole migration.
 */
export const IS_NUMERIC_BSON = { $type: "number" } as unknown as Condition<number>;
