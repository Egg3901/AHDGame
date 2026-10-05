import { Suspense } from "react";
import ConfirmEmailPageClient from "./ConfirmEmailPageClient";

export const metadata = {
  title: "Confirm email | A House Divided",
};

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailPageClient />
    </Suspense>
  );
}
