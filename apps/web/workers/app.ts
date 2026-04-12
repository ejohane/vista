import { createRequestHandler, RouterContextProvider } from "react-router";

import {
  cloudflareEnvContext,
  executionContextContext,
} from "@/lib/server-context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();

    context.set(cloudflareEnvContext, env);
    context.set(executionContextContext, ctx);

    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
