import { expect, request as apiRequest, test, type APIResponse } from "@playwright/test";

const androidUserAgent = "AHD-Android/0.4.0";

function expectPrivateAtEdge(response: APIResponse) {
  expect(["DYNAMIC", "BYPASS"]).toContain(response.headers()["cf-cache-status"]);
  expect(response.headers().age).toBeUndefined();
}

test.describe("CDN cache privacy", () => {
  test("keeps two authenticated sessions isolated from shared cache entries", async () => {
    const baseURL = process.env.CACHE_PRIVACY_BASE_URL;
    const credentials = [
      {
        email: process.env.CACHE_PRIVACY_EMAIL_A,
        password: process.env.CACHE_PRIVACY_PASSWORD_A,
      },
      {
        email: process.env.CACHE_PRIVACY_EMAIL_B,
        password: process.env.CACHE_PRIVACY_PASSWORD_B,
      },
    ];

    if (!baseURL || credentials.some(({ email, password }) => !email || !password)) {
      test.skip(
        true,
        "Set CACHE_PRIVACY_BASE_URL and both CACHE_PRIVACY account credentials to run this test"
      );
      return;
    }

    const contexts = await Promise.all(
      credentials.map(() => apiRequest.newContext({ baseURL, userAgent: androidUserAgent }))
    );

    try {
      for (let index = 0; index < contexts.length; index += 1) {
        const login = await contexts[index].post("/api/auth/login", {
          data: credentials[index],
        });
        expect(login.status()).toBe(200);
      }

      const cacheKey = `cache-privacy-${Date.now()}`;
      const identities: string[] = [];

      for (let round = 0; round < 3; round += 1) {
        for (const context of contexts) {
          const response = await context.get(`/api/auth/me?cache-privacy=${cacheKey}`);
          expect(response.status()).toBe(200);
          expectPrivateAtEdge(response);
          const body = (await response.json()) as { user?: { id?: string } };
          expect(body.user?.id).toBeTruthy();
          identities.push(body.user!.id!);
        }
      }

      const firstIdentity = identities[0];
      const secondIdentity = identities[1];
      expect(firstIdentity).not.toBe(secondIdentity);
      expect(identities.filter((_, index) => index % 2 === 0)).toEqual(
        Array(3).fill(firstIdentity)
      );
      expect(identities.filter((_, index) => index % 2 === 1)).toEqual(
        Array(3).fill(secondIdentity)
      );

      for (const path of ["/api/notifications", "/api/client-nav", "/profile"]) {
        for (const context of contexts) {
          const response = await context.get(`${path}?cache-privacy=${cacheKey}`);
          expect(response.status()).toBeLessThan(500);
          expectPrivateAtEdge(response);
        }
      }

      const anonymous = await apiRequest.newContext({ baseURL, userAgent: androidUserAgent });
      try {
        const publicPath = `/api/countries?cache-privacy=${cacheKey}`;
        const firstPublic = await anonymous.get(publicPath);
        const secondPublic = await anonymous.get(publicPath);
        expect(await firstPublic.body()).toEqual(await secondPublic.body());
        expect(secondPublic.headers()["cf-cache-status"]).toBe("HIT");

        for (const context of contexts) {
          const authenticatedPublic = await context.get(publicPath);
          expectPrivateAtEdge(authenticatedPublic);
        }
      } finally {
        await anonymous.dispose();
      }
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });
});
