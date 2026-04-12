import { SignUp } from "@clerk/react-router";
import { getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useSearchParams } from "react-router";

import { normalizeAppRedirectUrl } from "@/lib/auth.server";

export async function loader(args: LoaderFunctionArgs) {
  const auth = await getAuth(args);
  const userId = "userId" in auth ? auth.userId : null;

  if (userId) {
    throw redirect("/");
  }

  return null;
}

export function meta() {
  return [
    { title: "Vista | Sign Up" },
    { name: "description", content: "Create an account for your household." },
  ];
}

export default function SignUpRoute() {
  const [searchParams] = useSearchParams();
  const redirectUrl = normalizeAppRedirectUrl(searchParams.get("redirect_url"));

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <SignUp
        fallbackRedirectUrl={redirectUrl}
        forceRedirectUrl={redirectUrl}
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
      />
    </main>
  );
}
