import { HouseholdState } from "./household-state";

function readHealthPayload(request: Request) {
  return {
    path: new URL(request.url).pathname,
    status: "ok",
    worker: "vista-state",
  };
}

export { HouseholdState };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json(readHealthPayload(request));
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] !== "households" || !segments[1]) {
      return new Response("Household path is required.", { status: 404 });
    }

    const householdId = segments[1];
    const stub = env.HOUSEHOLD_STATE.get(
      env.HOUSEHOLD_STATE.idFromName(householdId),
    );

    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
