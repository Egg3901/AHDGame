"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PROFILE_BUTTON_CLASS } from "./profileStyles";

interface Props {
  href: string;
}

export function CopyProfileLinkButton({ href }: Props) {
  const t = useTranslations("profile.copyLink");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const url = `${window.location.origin}${href}`;
    // Guard the clipboard promise: Safari (and any non-user-activated context)
    // rejects writeText, and an un-caught rejection surfaces as an
    // "UnhandledRejection ... value: undefined" in GlitchTip. Swallow the
    // failure; copying is best-effort UI sugar.
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* clipboard unavailable / denied: no-op */
      });
  };

  return (
    <button type="button" onClick={handleCopy} title={t("title")} className={PROFILE_BUTTON_CLASS}>
      <span aria-live="polite">{copied ? t("copied") : t("share")}</span>
    </button>
  );
}
