// Client-side helper for a 401 from the API. Signs out first so the middleware
// no longer sees a valid session on /login (otherwise /login bounces back to
// /dashboard, which 401s again: a redirect loop).
export async function signOutAndGoToLogin(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login");
}
