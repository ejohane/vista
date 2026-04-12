import { describe, expect, test } from "bun:test";

import {
  decryptProviderToken,
  encryptProviderToken,
} from "./provider-credentials";

const TEST_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("provider credential encryption", () => {
  test("round-trips provider tokens with AES-GCM envelopes", async () => {
    const encryptedToken = await encryptProviderToken({
      keyVersion: 7,
      plaintext: "access-demo-123",
      secret: TEST_ENCRYPTION_KEY,
    });

    expect(encryptedToken).toMatch(/^v7\.[^.]+\.[^.]+$/);
    await expect(
      decryptProviderToken({
        encryptedToken,
        secret: TEST_ENCRYPTION_KEY,
      }),
    ).resolves.toBe("access-demo-123");
  });

  test("rejects malformed provider token envelopes", async () => {
    await expect(
      decryptProviderToken({
        encryptedToken: "not-a-valid-envelope",
        secret: TEST_ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("Encrypted provider token is malformed.");
  });
});
