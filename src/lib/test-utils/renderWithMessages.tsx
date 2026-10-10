import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/worldOrganizations.json";

/** Render office chrome with the same English message provider as the app. */
export function renderWithMessages(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}
