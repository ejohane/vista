import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readRequiredRedirectUrl() {
  const value = process.env.PLAID_REDIRECT_URI?.trim();

  if (!value) {
    throw new Error(
      "PLAID_REDIRECT_URI is required for the local HTTPS proxy.",
    );
  }

  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error(
      "PLAID_REDIRECT_URI must use https for the local HTTPS proxy.",
    );
  }

  if (!url.port) {
    throw new Error(
      "PLAID_REDIRECT_URI must include a non-privileged port such as :8443 for local HTTPS proxying.",
    );
  }

  return url;
}

async function ensureTailscaleCertificate(args: {
  certPath: string;
  domain: string;
  keyPath: string;
}) {
  const child = Bun.spawn(
    [
      "tailscale",
      "cert",
      "--cert-file",
      args.certPath,
      "--key-file",
      args.keyPath,
      "--min-validity",
      "24h",
      args.domain,
    ],
    {
      cwd: rootDir,
      env: process.env,
      stderr: "inherit",
      stdout: "inherit",
    },
  );

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`tailscale cert failed with exit code ${exitCode}.`);
  }
}

async function main() {
  const redirectUrl = readRequiredRedirectUrl();
  const listenPort = Number(redirectUrl.port);

  if (!Number.isInteger(listenPort) || listenPort <= 0) {
    throw new Error("PLAID_REDIRECT_URI must include a valid numeric port.");
  }

  if (
    listenPort < 1024 &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0
  ) {
    throw new Error(
      `PLAID_REDIRECT_URI port ${listenPort} requires elevated privileges. Use a high port such as 8443 instead.`,
    );
  }

  const listenHost =
    process.env.VISTA_HTTPS_BIND_HOST?.trim() ||
    process.env.VISTA_DEV_HOST?.trim() ||
    "127.0.0.1";
  const upstreamHost =
    process.env.VISTA_WEB_UPSTREAM_HOST?.trim() ||
    process.env.VISTA_DEV_HOST?.trim() ||
    "127.0.0.1";
  const upstreamPort = Number(process.env.VISTA_WEB_PORT?.trim() || "5173");
  const certDir = path.join(rootDir, ".tailscale", "certs");
  const certPath = path.join(certDir, `${redirectUrl.hostname}.crt`);
  const keyPath = path.join(certDir, `${redirectUrl.hostname}.key`);

  mkdirSync(certDir, { recursive: true });

  await ensureTailscaleCertificate({
    certPath,
    domain: redirectUrl.hostname,
    keyPath,
  });

  const cert = readFileSync(certPath, "utf8");
  const key = readFileSync(keyPath, "utf8");
  const upstreamOrigin = `http://${upstreamHost}:${upstreamPort}`;

  const server = https.createServer({ cert, key }, (request, response) => {
    const requestPath = request.url || "/";
    const targetUrl = new URL(requestPath, upstreamOrigin);
    const headers = {
      ...request.headers,
      host: `${upstreamHost}:${upstreamPort}`,
      "x-forwarded-host": redirectUrl.host,
      "x-forwarded-proto": "https",
    };
    const proxyRequest = http.request(targetUrl, {
      headers,
      method: request.method,
    });

    proxyRequest.on("response", (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.statusMessage,
        proxyResponse.headers,
      );
      proxyResponse.pipe(response);
    });

    proxyRequest.on("error", (error) => {
      console.error("[dev:https] Upstream proxy request failed.", error);

      if (!response.headersSent) {
        response.writeHead(502, {
          "content-type": "text/plain; charset=utf-8",
        });
      }

      response.end(
        "Vista local HTTPS proxy could not reach the web dev server.",
      );
    });

    if (request.method === "GET" || request.method === "HEAD") {
      proxyRequest.end();
      return;
    }

    request.pipe(proxyRequest);
  });

  server.listen(listenPort, listenHost, () => {
    console.log(
      `[dev:https] Listening on https://${redirectUrl.hostname}:${listenPort} -> ${upstreamOrigin}`,
    );
  });

  const closeServer = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  process.on("SIGINT", async () => {
    await closeServer();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closeServer();
    process.exit(0);
  });
}

await main();
