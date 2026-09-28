/** Map the PostHog experiment assignment to the rendered navigation. */
export function navigationVariantForAssignment(
  assignment: boolean | string | undefined
): "a" | "b" {
  return assignment === "test" || assignment === "b" ? "b" : "a";
}
