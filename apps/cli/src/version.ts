declare const VISTA_CLI_REPOSITORY: string | undefined;
declare const VISTA_CLI_VERSION: string | undefined;

export const CLI_REPOSITORY =
  typeof VISTA_CLI_REPOSITORY === "string"
    ? VISTA_CLI_REPOSITORY
    : "ejohane/vista";

export const CLI_VERSION =
  typeof VISTA_CLI_VERSION === "string" ? VISTA_CLI_VERSION : "0.0.0-dev";
