# Note

**What I built.** A lead follow-up agent for a 5-rep packaging-equipment sales team. Today's screen shows overdue leads in red, then due today, then upcoming. Each lead has a Hot, Warm or Cold tag, a one-line reason, an editable WhatsApp draft and a Mark as sent button. Reps can add leads and chat messages; the agent updates the lead. The owner sees all reps, tag counts and a rep filter. The assignment lists login as out of scope; I built a simple email/password login anyway, so each rep sees only their own leads.

**How the agent decides.** Hot: the buyer asked about price, quote, delivery or a visit, or showed buying intent recently. Warm: interested but waiting on something. Cold: no buyer reply for over 14 days, or an explicit "not now". The model reads the whole chat and returns tag, reason and draft, but dates are handled in code: follow-up is clamped to 0-1 days for Hot, 2-5 for Warm, 7-14 for Cold. If Gemini fails or returns bad JSON, keyword and recency rules take over. Seed leads are precomputed; the model runs only on add lead, add message and mark sent.

**AI tools I used.** Gemini 2.5 Flash inside the app. Claude Code to build it, with subagent reviews. Supabase for database, auth and security.

**What I'd build next.** Real WhatsApp Business API sending and receiving, a daily digest per rep, learning from replies, per-team rubric tuning, browser end-to-end tests, and an atomic mark-as-sent in one database function.
