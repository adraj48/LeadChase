import type { Lead, Message } from "@/lib/types";
import { buildContext, cleanPromptText } from "@/lib/draft-context";
import { EXAMPLES, persona, voiceRules } from "@/lib/draft-voice";

export { cleanPromptText, formatMessageTime } from "@/lib/draft-context";

// Pure prompt builder for the on-demand "Draft with agent" button. No network and no
// secrets here: the route (draft-stream.ts) sends what this returns to the model.

// Same model env var and thinking setting as the analysis call in agent.ts. A little
// more variation than the JSON call: grounding comes from the fact sheet and the checks.
export const DRAFT_GENERATION_CONFIG = {
  temperature: 0.5,
  topP: 0.9,
  maxOutputTokens: 220,
  thinkingConfig: { thinkingBudget: 0 },
} as const;

export const MAX_REPAIR_HINTS = 6;
export const MAX_REPAIR_HINT_CHARS = 200;

export interface DraftPromptInput {
  repFirstName: string;
  lead: Pick<Lead, "name" | "company" | "source" | "tag" | "reason" | "lastContactDate" | "followUpDate" | "draft">;
  messages: Pick<Message, "from" | "text" | "at">[];
  todayIST: string; // YYYY-MM-DD
  /** Problems found in a previous attempt: asks the model to write the message again without them. */
  repair?: string[];
}

export interface DraftPrompt {
  systemInstruction: string;
  userContent: string;
}

export function buildSystemInstruction(repFirstName: string): string {
  const rep = cleanPromptText(repFirstName, 40) || "the rep";
  return [persona(rep), voiceRules(rep), EXAMPLES, "OUTPUT\nOnly the message text, nothing else."].join("\n\n");
}

export function buildDraftPrompt(input: DraftPromptInput): DraftPrompt {
  const { text } = buildContext(input);
  const repair = (input.repair ?? [])
    .slice(0, MAX_REPAIR_HINTS)
    .map((r) => cleanPromptText(r, MAX_REPAIR_HINT_CHARS))
    .filter(Boolean);
  const parts = [text];
  if (repair.length > 0) {
    parts.push(
      `<repair>\nYour previous attempt had these problems. Write the message again and fix all of them:\n${repair.map((r) => `- ${r}`).join("\n")}\n</repair>`,
    );
  }
  parts.push("Write the next follow-up message now.");
  return { systemInstruction: buildSystemInstruction(input.repFirstName), userContent: parts.join("\n\n") };
}
