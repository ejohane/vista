export function normalizeAppRedirectUrl(value: null | string | undefined) {
  if (!value?.trim()) {
    return "/";
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
