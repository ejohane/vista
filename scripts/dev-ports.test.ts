import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";

import { isPortAvailable, resolveDevPort } from "./dev-ports";

const HOST = "127.0.0.1";

async function listenOnEphemeralPort() {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.listen(0, HOST, () => resolve());
    server.once("error", reject);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate an ephemeral test port.");
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    port: address.port,
  };
}

describe("resolveDevPort", () => {
  test("returns the default port when it is available", async () => {
    const ephemeral = await listenOnEphemeralPort();

    await ephemeral.close();

    const result = await resolveDevPort({
      defaultPort: ephemeral.port,
      host: HOST,
      label: "sync",
      maxOffset: 1,
    });

    expect(result).toEqual({
      port: ephemeral.port,
      usedFallback: false,
      usedOverride: false,
    });
  });

  test("falls back to the next port when the default port is occupied", async () => {
    const ephemeral = await listenOnEphemeralPort();

    try {
      const result = await resolveDevPort({
        defaultPort: ephemeral.port,
        host: HOST,
        label: "sync",
        maxOffset: 2,
      });

      expect(result).toEqual({
        port: ephemeral.port + 1,
        usedFallback: true,
        usedOverride: false,
      });
    } finally {
      await ephemeral.close();
    }
  });

  test("uses an explicit override when it is available", async () => {
    const ephemeral = await listenOnEphemeralPort();

    await ephemeral.close();

    const result = await resolveDevPort({
      defaultPort: 8788,
      envValue: String(ephemeral.port),
      host: HOST,
      label: "sync",
    });

    expect(result).toEqual({
      port: ephemeral.port,
      usedFallback: false,
      usedOverride: true,
    });
  });
});

describe("isPortAvailable", () => {
  test("reports false for an occupied port", async () => {
    const ephemeral = await listenOnEphemeralPort();

    try {
      await expect(
        isPortAvailable({
          host: HOST,
          port: ephemeral.port,
        }),
      ).resolves.toBe(false);
    } finally {
      await ephemeral.close();
    }
  });
});
