/**
 * `$type: "number"` in a form the driver's types accept.
 *
 * "number" is a server-side ALIAS covering int, long, double and decimal, which
 * is what the call sites want: these fields have been written as int32 and as
 * double over the life of the database. The Node driver's `BSONType` union
 * omits the alias, so writing it directly fails typecheck even though the query
 * is valid, and narrowing to one concrete BSON type would silently stop
 * matching the others.
 *
 * The runtime value is exactly the string "number". The cast is here, once,
 * with the reason attached, instead of being re-derived at each call site.
 */
export const NUMERIC_BSON_TYPE = "number" as unknown as "double";
