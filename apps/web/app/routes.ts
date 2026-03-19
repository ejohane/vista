import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("accounts/review", "routes/account-review.tsx"),
  route("connect/simplefin", "routes/connect-simplefin.tsx"),
  route("connect/snaptrade", "routes/connect-snaptrade.tsx"),
  route("connect/snaptrade/callback", "routes/connect-snaptrade-callback.tsx"),
  route("portfolio", "routes/portfolio.tsx"),
] satisfies RouteConfig;
