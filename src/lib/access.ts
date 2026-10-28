export type AccessDecision =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

// Segment-aware prefix match: "/dashboard" and "/dashboard/..." match,
// lookalikes such as "/dashboardx" do not.
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

export function decideAccess(pathname: string, signedIn: boolean): AccessDecision {
  const isRoot = pathname === "/";
  const isLogin = isUnder(pathname, "/login");
  const isDashboard = isUnder(pathname, "/dashboard");
  const isApi = isUnder(pathname, "/api");

  if (!signedIn) {
    if (isRoot || isDashboard) return { action: "redirect", to: "/login" };
    if (isApi) return { action: "unauthorized" };
    return { action: "next" };
  }
  if (isLogin || isRoot) return { action: "redirect", to: "/dashboard" };
  return { action: "next" };
}
