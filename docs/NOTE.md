# Note

**What I built.** A lead follow-up agent for a 5-rep packaging-equipment sales team. Today's screen shows overdue leads in red, then due today, then upcoming. Each lead has a Hot, Warm or Cold tag, a one-line reason, an editable WhatsApp draft and a Mark as sent button. Reps can add leads and chat messages; the agent updates the lead. The assignment lists login as out of scope, so there is none: the app opens on the dashboard, and a "Viewing as" switch in the header shows one rep's leads or all reps with tag counts. Opening a lead shows its header at once and loads the chat in one database trip.

**How the agent decides.** Hot: the buyer asked about price, quote, delivery or a visit, or showed buying intent recently. Warm: interested but waiting on something. Cold: no buyer reply for over 14 days, or an explicit "not now". The model reads the whole chat and returns tag, reason and draft, but dates are handled in code: follow-up is clamped to 0-1 days for Hot, 2-5 for Warm, 7-14 for Cold. If Gemini fails or returns bad JSON, keyword and recency rules take over. Seed leads are precomputed; the model runs only on add lead, add message and mark sent.

**AI tools I used.** Gemini 2.5 Flash inside the app. Claude Code to build it, with subagent reviews. Supabase for database, auth and security.

**What I'd build next.** Real authentication with per-user row level security, real WhatsApp Business API sending and receiving, evals for tags and drafts on labelled chats, a daily digest per rep, learning from replies and browser end-to-end tests.
