export function buildHouseholdPath(path: string, householdId: string) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set("householdId", householdId);

  return `${url.pathname}${url.search}`;
}

export function readRequestedHouseholdId(request: Request) {
  const householdId = new URL(request.url).searchParams.get("householdId");
  return householdId?.trim() || null;
}
