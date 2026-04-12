import {
  createHouseholdStateClientFromEnv,
  createRuntimeHouseholdService,
  readHouseholdStateMode,
} from "@vista/household-state";

function logParityMismatch(args: {
  householdId: string;
  legacy: unknown;
  operation: string;
  state: unknown;
}) {
  console.warn("Household state parity mismatch.", args);
}

export function createWebRuntimeHouseholdService(env: Env) {
  const householdStateEnv = env as Env & Record<string, unknown>;

  return createRuntimeHouseholdService({
    client: createHouseholdStateClientFromEnv(householdStateEnv),
    database: env.DB,
    mode: readHouseholdStateMode(householdStateEnv),
    onParityMismatch: logParityMismatch,
  });
}
