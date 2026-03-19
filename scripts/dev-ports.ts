import { createServer } from "node:net";

type ResolveDevPortArgs = {
  defaultPort: number;
  envValue?: string;
  host: string;
  label: string;
  maxOffset?: number;
};

export type ResolvedDevPort = {
  port: number;
  usedFallback: boolean;
  usedOverride: boolean;
};

function parsePort(value: string, label: string) {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${label} port override "${value}" is not a valid integer.`,
    );
  }

  const port = Number(normalized);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${label} port override "${value}" must be between 1 and 65535.`,
    );
  }

  return port;
}

export async function isPortAvailable(args: {
  host: string;
  port: number;
}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;

    server.unref();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }

      settled = true;

      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close((error) => {
        if (settled) {
          return;
        }

        settled = true;

        if (error) {
          reject(error);
          return;
        }

        resolve(true);
      });
    });

    server.listen(args.port, args.host);
  });
}

export async function resolveDevPort(
  args: ResolveDevPortArgs,
): Promise<ResolvedDevPort> {
  if (args.envValue?.trim()) {
    const overridePort = parsePort(args.envValue, args.label);
    const available = await isPortAvailable({
      host: args.host,
      port: overridePort,
    });

    if (!available) {
      throw new Error(
        `${args.label} port ${overridePort} is already in use. Choose another value for the port override.`,
      );
    }

    return {
      port: overridePort,
      usedFallback: false,
      usedOverride: true,
    };
  }

  const maxOffset = args.maxOffset ?? 20;

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const candidatePort = args.defaultPort + offset;
    const available = await isPortAvailable({
      host: args.host,
      port: candidatePort,
    });

    if (available) {
      return {
        port: candidatePort,
        usedFallback: candidatePort !== args.defaultPort,
        usedOverride: false,
      };
    }
  }

  throw new Error(
    `Could not find an open ${args.label} port between ${args.defaultPort} and ${args.defaultPort + maxOffset}.`,
  );
}
