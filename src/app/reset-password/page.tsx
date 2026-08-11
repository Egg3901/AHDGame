import { Suspense } from "react";
import ResetPasswordPageClient from "./ResetPasswordPageClient";

export const metadata = {
  title: "Reset Password | A House Divided",
};

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordPageClient />
    </Suspense>
  );
}
