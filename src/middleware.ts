import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/access";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Refreshed cookies/headers collected from Supabase, re-applied to whatever
  // response we finally return (including redirects and 401s).
  let pending: { name: string; value: string; options?: object }[] = [];
  let pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          pending = cookiesToSet;
          pendingHeaders = headers ?? {};
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(pendingHeaders).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // getClaims() validates the JWT; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;

  const decision = decideAccess(request.nextUrl.pathname, signedIn);
  if (decision.action === "next") return response;

  const out =
    decision.action === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.json({ error: "Not signed in" }, { status: 401 });
  pending.forEach(({ name, value, options }) => out.cookies.set(name, value, options));
  Object.entries(pendingHeaders).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
