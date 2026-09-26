import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/interrogate/route";
import { CharacterResponseSchema } from "@/ai/schemas";

const call = async (body: unknown) => {
  const res = await POST(
    new Request("http://test/api/interrogate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { response: unknown; error?: string } };
};

describe("POST /api/interrogate (stub)", () => {
  it.each([
    { type: "whereabouts" },
    { type: "victim" },
    { type: "about_suspect", suspectId: "victoria" },
    { type: "present_evidence", evidenceId: "placeholder-clue-1" },
    { type: "free_text", text: "Did you do it?" },
  ])("returns a valid CharacterResponse for %o", async (action) => {
    const { status, json } = await call({ characterId: "reginald", action });
    expect(status).toBe(200);
    expect(CharacterResponseSchema.safeParse(json.response).success).toBe(true);
    expect(json.error).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/solution|murderer|placeholder-weapon|gregory-secret/i);
  });

  it("includes an evidence reaction when evidence is presented", async () => {
    const { json } = await call({ characterId: "reginald", action: { type: "present_evidence", evidenceId: "placeholder-clue-2" } });
    expect((json.response as { evidenceReactions: unknown[] }).evidenceReactions).toHaveLength(1);
  });

  it.each([
    ["invalid JSON", "{nope", 400],
    ["bad shape", { characterId: "reginald", action: { type: "dance" } }, 400],
    ["extra keys", { characterId: "reginald", action: { type: "victim" }, solution: true }, 400],
    ["unknown character", { characterId: "nobody", action: { type: "victim" } }, 404],
    ["asking about self", { characterId: "reginald", action: { type: "about_suspect", suspectId: "reginald" } }, 400],
    ["undiscovered evidence", { characterId: "reginald", action: { type: "present_evidence", evidenceId: "placeholder-weapon" } }, 400],
  ])("returns the in-character fallback on %s", async (_label, body, status) => {
    const res = await call(body);
    expect(res.status).toBe(status);
    expect(res.json.error).toBeTruthy();
    expect(CharacterResponseSchema.safeParse(res.json.response).success).toBe(true);
  });
});
