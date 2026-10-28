import { describe, it, expect } from "vitest";
import { decideAccess } from "@/lib/access";

const next = { action: "next" };
const to = (p: string) => ({ action: "redirect", to: p });

describe("decideAccess", () => {
  it("signed out: / and /dashboard* go to /login", () => {
    expect(decideAccess("/", false)).toEqual(to("/login"));
    expect(decideAccess("/dashboard", false)).toEqual(to("/login"));
    expect(decideAccess("/dashboard/leads/1", false)).toEqual(to("/login"));
  });
  it("signed out: /api/* is unauthorized", () => {
    expect(decideAccess("/api/leads", false)).toEqual({ action: "unauthorized" });
    expect(decideAccess("/api/auth/logout", false)).toEqual({ action: "unauthorized" });
  });
  it("signed out: /login is allowed", () => {
    expect(decideAccess("/login", false)).toEqual(next);
  });
  it("signed in: /login and / go to /dashboard", () => {
    expect(decideAccess("/login", true)).toEqual(to("/dashboard"));
    expect(decideAccess("/", true)).toEqual(to("/dashboard"));
  });
  it("signed in: dashboard and api pass through", () => {
    expect(decideAccess("/dashboard", true)).toEqual(next);
    expect(decideAccess("/dashboard/x", true)).toEqual(next);
    expect(decideAccess("/api/leads", true)).toEqual(next);
  });
  it("lookalike paths are not treated as protected or login", () => {
    expect(decideAccess("/dashboardx", false)).toEqual(next);
    expect(decideAccess("/apixyz", false)).toEqual(next);
    expect(decideAccess("/loginfoo", true)).toEqual(next);
    expect(decideAccess("/loginfoo", false)).toEqual(next);
  });
});
