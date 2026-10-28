import { describe, it, expect } from "vitest";
import { mapRep, mapLead, mapMessage, leadToRow } from "@/lib/mappers";

describe("mappers", () => {
  it("maps a rep row to { id, name } only", () => {
    expect(mapRep({ id: "r1", name: "Anil" })).toEqual({ id: "r1", name: "Anil" });
  });

  const leadRow = {
    id: "l1", rep_id: "r1", name: "Suresh", company: "Acme", phone: "+91 98111 22233",
    source: "IndiaMART", last_contact_date: "2026-10-20", tag: "Hot", reason: "asked price",
    follow_up_date: "2026-10-29", draft: "Hi", analysis_source: "seed",
  };

  it("maps a lead row with joined rep name (object)", () => {
    const l = mapLead({ ...leadRow, reps: { name: "Anil" } });
    expect(l).toEqual({
      id: "l1", repId: "r1", repName: "Anil", name: "Suresh", company: "Acme",
      phone: "+91 98111 22233", source: "IndiaMART", lastContactDate: "2026-10-20",
      tag: "Hot", reason: "asked price", followUpDate: "2026-10-29", draft: "Hi",
      analysisSource: "seed",
    });
  });

  it("maps the analysis columns only when the row has them", () => {
    const withCols = mapLead({ ...leadRow, analysis_status: "pending", analysis_started_at: "2026-10-29T10:00:00+00:00" });
    expect(withCols.analysisStatus).toBe("pending");
    expect(withCols.analysisStartedAt).toBe("2026-10-29T10:00:00+00:00");
    expect(mapLead({ ...leadRow, analysis_status: "ready" }).analysisStartedAt).toBeNull();
    expect(mapLead(leadRow)).not.toHaveProperty("analysisStatus");
  });

  it("handles joined rep as array, null or missing", () => {
    expect(mapLead({ ...leadRow, reps: [{ name: "Bina" }] }).repName).toBe("Bina");
    expect(mapLead({ ...leadRow, reps: null }).repName).toBe("");
    expect(mapLead({ ...leadRow }).repName).toBe("");
  });

  it("maps a message row (sender->from, body->text, sent_at->at)", () => {
    expect(
      mapMessage({ id: "m1", lead_id: "l1", sender: "buyer", body: "rate?", sent_at: "2026-10-20T10:00:00+00:00" }),
    ).toEqual({ id: "m1", leadId: "l1", from: "buyer", text: "rate?", at: "2026-10-20T10:00:00+00:00" });
  });

  it("leadToRow produces snake_case insert/update columns", () => {
    expect(
      leadToRow({ tag: "Warm", reason: "r", followUpDate: "2026-11-01", draft: "d", analysisSource: "llm" }),
    ).toEqual({ tag: "Warm", reason: "r", follow_up_date: "2026-11-01", draft: "d", analysis_source: "llm" });
  });
});
