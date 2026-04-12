import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  index("routes/home.tsx"),
  route("accounts/review", "routes/account-review.tsx"),
  route("connect/plaid", "routes/connect-plaid.tsx"),
  route("portfolio", "routes/portfolio.tsx"),
] satisfies RouteConfig;
