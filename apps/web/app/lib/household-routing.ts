export function buildHouseholdPath(path: string, householdId: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set("householdId", householdId);

  return `${url.pathname}${url.search}`;
}

export function readRequestedHouseholdId(request: Request) {
  const householdId = new URL(request.url).searchParams.get("householdId");
  return householdId?.trim() || null;
}

export function resolveViewerHouseholdId(
  request: Request,
  viewerHouseholdId: string,
) {
  const requestedHouseholdId = readRequestedHouseholdId(request);

  if (!requestedHouseholdId) {
    return viewerHouseholdId;
  }

  if (requestedHouseholdId !== viewerHouseholdId) {
    throw new Error("The requested household is not available.");
  }

  return requestedHouseholdId;
}
