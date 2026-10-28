import { describe, it, expect } from "vitest";
import { ALL_REPS_VIEWER, parseRepScope } from "@/lib/access";

const REP = "33333333-3333-4333-8333-333333333333";

describe("parseRepScope (?rep=)", () => {
  it("missing, empty or 'all' means every rep", () => {
    expect(parseRepScope(null)).toEqual({ kind: "all" });
    expect(parseRepScope("")).toEqual({ kind: "all" });
    expect(parseRepScope("  ")).toEqual({ kind: "all" });
    expect(parseRepScope("all")).toEqual({ kind: "all" });
    expect(parseRepScope("ALL")).toEqual({ kind: "all" });
  });
  it("'default' asks the server to pick the default rep (case-insensitive)", () => {
    expect(parseRepScope("default")).toEqual({ kind: "default" });
    expect(parseRepScope(" DEFAULT ")).toEqual({ kind: "default" });
  });
  it("a uuid selects that rep (normalised to lower case)", () => {
    expect(parseRepScope(REP)).toEqual({ kind: "rep", repId: REP });
    expect(parseRepScope(REP.toUpperCase())).toEqual({ kind: "rep", repId: REP });
  });
  it("anything else is invalid", () => {
    for (const bad of ["nope", "123", `${REP}x`, "all,all", "' or 1=1 --", REP.slice(1)]) {
      expect(parseRepScope(bad), bad).toEqual({ kind: "invalid" });
    }
  });
});

describe("ALL_REPS_VIEWER", () => {
  it("is the fixed all-reps viewer (no login)", () => {
    expect(ALL_REPS_VIEWER).toEqual({ id: "all", name: "All reps", email: "", role: "owner" });
  });
});
