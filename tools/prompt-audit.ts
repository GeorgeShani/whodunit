/**
 * PROMPT-SURFACE AUDIT (npm run audit:prompts): builds the REAL prompt (ai/perform-turn.ts prepareTurn) for every
 * character across the states that change it, lists which true facts and secrets each prompt carries, and FAILS if
 * the culprit's prompt holds any unrevealed core-guilt content: a core-guilt secret (id or description), a fact a
 * core-guilt secret covers (id or statement), the murder minute, or the solution's explanation.
 *
 * States per character: fresh; each single revealable secret admitted; all revealable secrets admitted; every
 * evidence item shown; every public testimony card shown; maximum pressure (stress 100, everything shown, every
 * other character's revealable secret out, the next reveal and breakdown directives live).
 *
 * No model is called. Case-agnostic.
 */
import { prepareTurn } from "@/ai/perform-turn";
import { spokenTime } from "@/ai/prompts/interrogation";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltFactIds, coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { publicTestimonies } from "@/engine/testimony";
import type { GameState } from "@/engine/types";

export interface PromptRow {
  characterId: string;
  state: string;
  facts: string[];
  secrets: string[];
  /** This turn's reveal directive (if the engine chose one). */
  reveal: string | null;
  breakdown: boolean;
  exposedLies: string[];
  chars: number;
  problems: string[];
  /** Allowed but worth knowing (e.g. the murder minute only inside a third party's public testimony card). */
  notes: string[];
}

export interface AuditResult {
  caseId: string;
  murdererId: string;
  coreSecretIds: string[];
  coreFactIds: string[];
  rows: PromptRow[];
  failures: { characterId: string; state: string; problem: string }[];
}

const Q = "Tell me again where you were when the lights went out, and what you know about the death.";

export function auditCase(c: LoadedCase): AuditResult {
  const core = coreGuiltSecretIds(c);
  const murderer = c.characters.find((x) => x.id === c.solution.murdererId)!;
  const coreFacts = coreGuiltFactIds(c, murderer);
  const allFacts = new Map([...c.facts, ...c.timeline].map((f) => [f.id, f]));
  const coreSecrets = murderer.secrets.filter((s) => core.has(s.id));
  const rows: PromptRow[] = [];
  const failures: AuditResult["failures"] = [];
  const revealable = (chId: string) => c.characters.find((x) => x.id === chId)!.secrets.filter((s) => !core.has(s.id));

  const withRevealed = (g: GameState, chId: string, ids: string[]) => {
    for (const id of ids) {
      if (!g.revealedSecretIds.includes(id)) g.revealedSecretIds.push(id);
      const cs = g.characters[chId];
      if (!cs.revealedSecretIds.includes(id)) cs.revealedSecretIds.push(id);
    }
  };
  const everyoneElseRevealed = (g: GameState, chId: string) => {
    for (const other of c.characters) if (other.id !== chId) withRevealed(g, other.id, revealable(other.id).map((s) => s.id));
  };

  const run = (chId: string, state: string, g: GameState, move: { presentedEvidenceId?: string; presentedTestimonyId?: string } = {}) => {
    const p = prepareTurn({ caseData: c, game: g, characterId: chId, question: Q, move: { ...move, allowReveal: true } });
    const text = `${p.system}\n${p.user}`;
    const secrets = p.ctx.secrets.map((s) => s.id);
    const reveal = p.directives.revealSecret?.id ?? null;
    const problems: string[] = [];
    const notes: string[] = [];
    if (chId === murderer.id) {
      for (const k of p.ctx.knowledge) if (coreFacts.has(k.id)) problems.push(`core fact ${k.id} in knowledge`);
      for (const id of [...secrets, ...(reveal ? [reveal] : [])]) if (core.has(id)) problems.push(`core secret ${id} admitted/revealed`);
      for (const s of coreSecrets) {
        if (text.includes(s.id)) problems.push(`core secret id ${s.id} in prompt text`);
        if (text.includes(s.description)) problems.push(`core secret ${s.id} description in prompt text`);
      }
      for (const id of coreFacts) {
        const f = allFacts.get(id);
        if (f && f.statement.length > 20 && text.includes(f.statement)) problems.push(`core fact ${id} statement in prompt text`);
      }
      // The murder minute as THEIR knowledge. Public material the detective holds (other people's testimony cards, clue
      // descriptions, the player's own words) may carry it as someone else's account ("at 21:17 he heard a thud").
      let own = text;
      for (const pub of [...publicTestimonies(c, g).map((x) => x.summary), ...c.evidence.map((e) => e.description), Q]) own = own.split(pub).join("");
      const t = c.solution.time;
      const hit = (s: string) => new RegExp(`\\b${t}\\b`).test(s) || s.toLowerCase().includes(spokenTime(t).toLowerCase());
      if (hit(own)) problems.push(`murder minute ${t} in prompt text`);
      else if (hit(text)) notes.push(`murder minute ${t} only via public cards/clues`);
      if (c.solution.explanation && text.includes(c.solution.explanation.slice(0, 60))) problems.push("solution explanation in prompt text");
    }
    for (const pr of problems) failures.push({ characterId: chId, state, problem: pr });
    rows.push({
      characterId: chId,
      state,
      facts: p.ctx.knowledge.map((k) => k.id),
      secrets,
      reveal,
      breakdown: Boolean(p.directives.breakdown),
      exposedLies: p.directives.exposedLieIds,
      chars: text.length,
      problems,
      notes,
    });
  };

  for (const ch of c.characters) {
    const fresh = () => {
      const g = createInitialGameState(c);
      g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
      return g;
    };
    run(ch.id, "fresh", createInitialGameState(c));
    for (const s of revealable(ch.id)) {
      const g = fresh();
      withRevealed(g, ch.id, [s.id]);
      run(ch.id, `admitted ${s.id}`, g);
    }
    if (revealable(ch.id).length > 1) {
      const g = fresh();
      withRevealed(g, ch.id, revealable(ch.id).map((s) => s.id));
      run(ch.id, "all revealable admitted", g);
    }
    for (const e of c.evidence) run(ch.id, `shown ${e.id}`, fresh(), { presentedEvidenceId: e.id });
    const cards = (() => {
      const g = fresh();
      everyoneElseRevealed(g, ch.id);
      return publicTestimonies(c, g).filter((x) => x.characterId !== ch.id);
    })();
    for (const card of cards) {
      const g = fresh();
      everyoneElseRevealed(g, ch.id);
      run(ch.id, `card ${card.id}`, g, { presentedTestimonyId: card.id });
    }
    // Maximum pressure: stress at the top, every clue shown to them, every other card out, all their revealable
    // secrets admitted, then one more clue on top (George's state, generalised).
    const g = fresh();
    everyoneElseRevealed(g, ch.id);
    withRevealed(g, ch.id, revealable(ch.id).map((s) => s.id));
    g.characters[ch.id].stress = 100;
    g.characters[ch.id].evidenceShownIds = c.evidence.map((e) => e.id);
    run(ch.id, "max pressure, everything shown", g, cards[0] ? { presentedTestimonyId: cards[0].id } : {});
    // The breakdown turn itself: just under the top, then a clue that tips them over.
    const b = fresh();
    b.characters[ch.id].stress = 95;
    run(ch.id, "breakdown turn", b, c.evidence[0] ? { presentedEvidenceId: c.solution.keyEvidenceIds[0] ?? c.evidence[0].id } : {});
  }
  return { caseId: c.id, murdererId: murderer.id, coreSecretIds: [...core], coreFactIds: [...coreFacts], rows, failures };
}

export function renderSurface(results: AuditResult[]): string {
  const out: string[] = [
    "# Prompt surface",
    "",
    "Generated by `npm run audit:prompts` (tools/prompt-audit.ts). Do not edit by hand.",
    "",
    "For every character and every state that changes their prompt, this lists the true facts (WHAT YOU KNOW ids) and",
    "the secrets the prompt carries. The audit FAILS if the culprit's prompt holds any unrevealed core-guilt content.",
    "",
  ];
  for (const r of results) {
    const failing = r.failures.length;
    out.push(`## Case \`${r.caseId}\``, "");
    out.push(`- Culprit: \`${r.murdererId}\``);
    out.push(`- Core-guilt secrets (never in the culprit's prompt): ${r.coreSecretIds.map((x) => `\`${x}\``).join(", ") || "none"}`);
    out.push(`- Facts they cover (withheld): ${r.coreFactIds.map((x) => `\`${x}\``).join(", ") || "none"}`);
    out.push(`- Prompts built: ${r.rows.length}. Result: ${failing ? `**FAIL (${failing} problems)**` : "**PASS** (no core-guilt content in any culprit prompt)"}`);
    out.push("");
    for (const chId of [...new Set(r.rows.map((x) => x.characterId))]) {
      const rows = r.rows.filter((x) => x.characterId === chId);
      const counts = rows.map((x) => x.facts.length);
      out.push(`### ${chId}${chId === r.murdererId ? " (culprit)" : ""}`, "");
      out.push(`Facts per prompt: min ${Math.min(...counts)}, max ${Math.max(...counts)}. Prompt size: up to ${Math.max(...rows.map((x) => x.chars))} chars (~${Math.round(Math.max(...rows.map((x) => x.chars)) / 4)} tokens).`, "");
      const base = new Set(rows[0].facts);
      out.push(`Fresh facts (${rows[0].facts.length}): ${rows[0].facts.map((x) => `\`${x}\``).join(", ") || "none"}`, "");
      out.push("| State | Facts | Facts added vs fresh | Secrets admitted | Reveal this turn | Breakdown | Exposed lies | Problems | Notes |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const x of rows) {
        const added = x.facts.filter((f) => !base.has(f));
        out.push(
          `| ${x.state} | ${x.facts.length} | ${added.join(", ") || "none"} | ${x.secrets.join(", ") || "none"} | ${x.reveal ?? "none"} | ${x.breakdown ? "yes" : ""} | ${x.exposedLies.join(", ") || ""} | ${x.problems.join("; ") || "none"} | ${x.notes.join("; ")} |`,
        );
      }
      out.push("");
    }
  }
  return out.join("\n");
}
