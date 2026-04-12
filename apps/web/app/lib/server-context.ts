import { createContext, type RouterContextProvider } from "react-router";

export const cloudflareEnvContext = createContext<Env>();
export const executionContextContext = createContext<ExecutionContext>();

type LegacyCloudflareContext = {
  cloudflare: {
    env: Env;
  };
};

export function readCloudflareEnv(
  context: LegacyCloudflareContext | Readonly<RouterContextProvider>,
) {
  if ("get" in context) {
    return context.get(cloudflareEnvContext);
  }

  return context.cloudflare.env;
}
