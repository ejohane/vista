export function readLocalHttpsRedirectUrl(
  env: Record<string, string | undefined>,
) {
  const redirectUrlValue = env.PLAID_REDIRECT_URI?.trim();

  if (!redirectUrlValue) {
    return null;
  }

  const redirectUrl = new URL(redirectUrlValue);

  if (
    redirectUrl.protocol !== "https:" ||
    !redirectUrl.hostname.endsWith(".ts.net")
  ) {
    return null;
  }

  return redirectUrl;
}

export function rewriteUrlPort(url: URL, port: number) {
  const rewrittenUrl = new URL(url);

  rewrittenUrl.port = String(port);

  return rewrittenUrl;
}
