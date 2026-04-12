import { createHouseholdStateClient } from "./client";

export type HouseholdStateMode = "dual" | "legacy" | "state";

type StateServiceBinding = {
  fetch: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function hasStateServiceBinding(value: unknown): value is StateServiceBinding {
  return typeof value === "object" && value !== null && "fetch" in value;
}

export function readHouseholdStateMode(env: Record<string, unknown>) {
  const configuredMode =
    typeof env.HOUSEHOLD_STATE_MODE === "string"
      ? env.HOUSEHOLD_STATE_MODE.trim()
      : "";

  if (
    configuredMode === "legacy" ||
    configuredMode === "dual" ||
    configuredMode === "state"
  ) {
    return configuredMode satisfies HouseholdStateMode;
  }

  if (hasStateServiceBinding(env.STATE_SERVICE)) {
    return "state" satisfies HouseholdStateMode;
  }

  if (
    typeof env.HOUSEHOLD_STATE_BASE_URL === "string" &&
    env.HOUSEHOLD_STATE_BASE_URL.trim()
  ) {
    return "state" satisfies HouseholdStateMode;
  }

  return "legacy" satisfies HouseholdStateMode;
}

export function createHouseholdStateClientFromEnv(
  env: Record<string, unknown>,
) {
  const stateService = env.STATE_SERVICE;

  if (hasStateServiceBinding(stateService)) {
    return createHouseholdStateClient({
      fetcher: (input, init) => stateService.fetch(input, init),
    });
  }

  const baseUrl =
    typeof env.HOUSEHOLD_STATE_BASE_URL === "string"
      ? env.HOUSEHOLD_STATE_BASE_URL.trim()
      : "";

  if (!baseUrl) {
    return null;
  }

  return createHouseholdStateClient({
    fetcher: (input, init) => {
      const url = new URL(String(input), baseUrl);
      return fetch(url, init);
    },
  });
}
