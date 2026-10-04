import ProfileLoading from "@/app/profile/loading";

// The character profile renders the same identity block, tab row and
// two-column layout as /profile (its own segment) but runs ~30 Mongo queries
// server-side before returning any bytes. Without a skeleton, App Router shows
// a blank page for the whole SSR wait; reusing the profile skeleton keeps the
// two in step and makes navigation feel instant.
export default function CharacterLoading() {
  return <ProfileLoading />;
}
