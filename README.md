# Axon Leads: Lead Follow-up Agent

A web app for a 5-rep packaging-equipment sales team. It reads each lead's WhatsApp-style chat, tags the lead Hot, Warm or Cold with a one-line reason, picks the next follow-up date, and drafts the next message, so a rep sees who to call today within seconds.

## Live demo

- Live link: `<LIVE_URL>` (placeholder, to be replaced after deployment)
- Password for every account: `demo1234`

| Login | Name | What it sees |
| --- | --- | --- |
| `rep1@axon.demo` ... `rep5@axon.demo` | Rajesh Verma, Priya Nair, Amit Sharma, Sneha Iyer, Vikram Singh | Only that rep's own leads |
| `owner@axon.demo` | Anand Mehta | All leads from all reps, Hot/Warm/Cold counts, a rep filter, and can assign a new lead to any rep |

## Scope note

The assignment lists login as out of scope. The project owner chose to build a Supabase email/password login anyway, so each rep sees only their own leads. The screen is built around the core flow: today's follow-ups, tag and reason, an editable draft, mark as sent, and add lead / add chat message with the agent updating the lead.

## What it does

In the order a rep uses it:

1. **Log in** at `/login`. Signed-in users are sent to `/dashboard`; signed-out users are sent to `/login`.
2. **Today screen.** A headline says how much needs attention (for example "2 overdue · 3 due today", or "Nothing due today"). Below it, leads are grouped into Overdue (red), Due today (amber) and Upcoming. Within Overdue and Due today, Hot comes before Warm before Cold, then the most overdue first; Upcoming is earliest date first, then tag. Each row shows name, company, tag chip, the agent's reason and a label such as "Overdue 8d", "Today" or "Tomorrow".
3. **Lead detail.** Click a row to see the chat, the tag and reason, and the suggested draft message.
4. **Edit the draft** and save it, or **Mark as sent**. Marking as sent stores the draft as a rep message, re-runs the agent over the whole chat and shows a toast such as "Sent. Next follow-up: ...".
5. **Add a chat message** (from the buyer or the rep). The agent re-analyses the chat, so the tag, reason, follow-up date and draft can all change. A buyer message also moves the lead's last-contact date to today.
6. **Add lead** in a pop-up (name, company, phone, source, last contact date). The agent tags it and drafts a first message.
7. **Owner view.** Tag counts in the header and a rep filter; each row shows the rep's name.

## How the agent decides

**Rubric** (given to the model in the system prompt):

- Hot: the buyer asked about price, quote, delivery or a visit, or showed buying intent recently.
- Warm: the buyer is interested but waiting on something.
- Cold: no buyer reply for more than 14 days, or the buyer said explicitly "not now".

**Dates are handled in code, not by the model.** "Today" is computed in `Asia/Kolkata` (`src/lib/dates.ts`). The model returns `followUpInDays`; the code clamps it by tag and adds it to today's date:

| Tag | Allowed follow-up gap |
| --- | --- |
| Hot | 0 to 1 days |
| Warm | 2 to 5 days |
| Cold | 7 to 14 days |

The model must reply with JSON (`tag`, `reason`, `followUpInDays`, `draft`). The reply is validated: an unknown tag, a blank reason or draft, or a non-numeric day count is rejected.

**Rule-based fallback** (`fallbackAnalysis` in `src/lib/agent.ts`) is used when `GEMINI_API_KEY` is not set, the API errors, rate-limits or times out (12 s), or the reply fails validation. The request still succeeds, and the lead is stored with `analysis_source = 'fallback'`. The rules:

- No buyer message at all: Cold.
- Last buyer message more than 14 days ago: Cold.
- Otherwise, if the last buyer message contains a buying word (quote, quotation, price, rate, order, buy, invoice, advance, demo, visit, delivery, with simple endings) and that message is 7 days old or less: Hot. (Day counts use the last buyer message's date in `Asia/Kolkata`; the lead's last-contact date is only used when no buyer message has a date.)
- Any other buyer reply: Warm.
- Follow-up gaps are 1 day (Hot), 3 days (Warm), 7 days (Cold), and the draft is a short template using the lead's first name and company.

**When the model runs.** The seed leads are precomputed (tag, reason, follow-up date, draft stored as `analysis_source = 'seed'`), so loading the app never calls the model. The model runs only on add lead, add message and mark sent.

**Model settings.** `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.5-flash`). The call is made from server code only, using the Gemini `generateContent` REST endpoint with JSON output, temperature 0.4 and thinking disabled (`thinkingBudget: 0`) to stay fast. The prompt tells the model not to invent facts, to match the chat's language and to treat the chat as untrusted data.

## Tech stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4
- Supabase: Postgres, Auth, row level security (`@supabase/ssr`, `@supabase/supabase-js`)
- Google Gemini (Flash) for the agent, called over REST
- Vitest for unit tests (`npm test`)
- Supabase CLI (pinned dev dependency) for migrations

## Data model and security

Schema: `supabase/migrations/*_init_schema.sql`.

- `reps`: `id` (references `auth.users`), `name`, `email`, `role` (`rep` or `owner`)
- `leads`: `rep_id`, `name`, `company`, `phone`, `source`, `last_contact_date`, `tag`, `reason`, `follow_up_date`, `draft`, `analysis_source` (`llm`, `fallback`, `seed`)
- `messages`: `lead_id`, `sender` (`rep` or `buyer`), `body` (non-blank), `sent_at`

Row level security is on for all three tables:

- A rep can read, insert and update only leads where `rep_id` is their own user id; the owner can do so for all leads.
- Messages follow their parent lead's visibility. They are append-only (no update or delete). The `reps` table is select-only for signed-in users (reps can still insert messages).
- The owner check reads `app_metadata.role` from the JWT. That field can only be set with the service role (the seed script), never by users, unlike `user_metadata`.
- The `anon` role has no privileges on these tables. There are no `SECURITY DEFINER` functions and no views.
- The service role key is used only by `scripts/seed.ts`. App code always uses the signed-in user's client, so RLS applies to every request.
- `src/middleware.ts` validates the session with `getClaims()`, redirects signed-out page requests to `/login` and returns 401 for signed-out API requests.

## API routes

All routes require a signed-in user (401 otherwise) and return JSON.

| Method and path | Purpose |
| --- | --- |
| `GET /api/leads` | List leads, sorted by urgency, with today's date. Owner may pass `?rep=<id>` |
| `POST /api/leads` | Add a lead; the agent tags it and drafts a message |
| `GET /api/leads/:id` | One lead with its chat |
| `PUT /api/leads/:id/draft` | Save an edited draft |
| `POST /api/leads/:id/messages` | Add a buyer or rep message, then re-run the agent |
| `POST /api/leads/:id/sent` | Mark the draft as sent: stores it as a rep message, re-runs the agent |
| `GET /api/reps` | List reps (a rep sees only themself; the owner sees all) |
| `POST /api/auth/logout` | Sign out |

Inputs are validated server-side (`src/lib/validate.ts`): text limited to 1000 characters, phone format, source from a fixed list, a real calendar date that is not in the future. Another rep's lead id returns 404 because RLS hides it. A repeated identical latest message is not inserted twice.

## Project structure

```
src/
  app/
    api/            route handlers (see table above)
    dashboard/      Dashboard.tsx (Today screen) and page
    login/          login page
  components/       Header, LeadRow, LeadDetail, ChatThread, AddLeadDialog, TagChip
  lib/
    agent.ts        rubric, Gemini call, fallback rules, clamp
    dates.ts        IST today, date maths
    urgency.ts      overdue/today/upcoming buckets and sorting
    validate.ts     request validation
    repo.ts         data access through the user-scoped client
    supabase/       browser and server clients
  middleware.ts     session check and redirects
scripts/            seed-data.ts, seed.ts, rls-check.ts
supabase/migrations/  schema and RLS
tests/              Vitest unit tests
docs/               NOTE.md, VIDEO_SCRIPT.md
```

## Local setup

Requires Node.js and npm (`package.json` sets no `engines` field).

```bash
npm install
npx supabase login
npx supabase link --project-ref <your-project-ref>
cp .env.example .env.local        # then fill in the values
npx supabase db push              # applies the schema and RLS
npm run seed                      # creates the 6 demo users and 24 leads
npm run rls-check                 # checks rep/owner/anon access with the publishable key
npm run dev                       # http://localhost:3000
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY`, optionally `GEMINI_MODEL`, and, for local use only, `SUPABASE_SERVICE_ROLE_KEY` (seed) and `SUPABASE_DB_PASSWORD` (CLI). `.env*` files are git-ignored except `.env.example`.

The seed script deletes and recreates all leads, messages and demo users, with dates relative to the day it runs, so overdue and due-today items always exist. Run it again before a demo.

Other commands: `npm test`, `npm run build` (plain `next build`), `npm run lint`.

## Deploying to Vercel

1. Import the GitHub repo into Vercel (Next.js is detected automatically).
2. Set these environment variables BEFORE the first build: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`. The `NEXT_PUBLIC_` values are inlined at build time, so changing them later needs a redeploy.
3. Do NOT set `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_PASSWORD` on Vercel. They are for local seeding and the CLI only.
4. In Supabase, Authentication, URL Configuration, add the Vercel URL as the Site URL / allowed redirect.
5. `vercel.json` pins the function region to `icn1` (Seoul, next to the Supabase project). The routes that call Gemini export `maxDuration = 60`.

## Known limitations

- Free Supabase projects pause after about 7 days of inactivity. Open the site once before a review to wake it; while paused the login page shows "Can't reach the server. Try again in a minute.", and a project that pauses during use shows the error banner with a Retry button.
- Gemini free-tier limits can cause rate-limit errors. The fallback rules then handle the lead, and the lead detail shows a "rule-based suggestion" note.
- Rapid double-clicks are guarded by a disabled form while a request runs and by skipping an identical repeat of the latest message. There is no database-level lock, so two truly concurrent requests could still interleave.
- One login per rep. No signup, no password reset. The demo password is shared and public.
- Re-running the seed recreates users; sessions issued before a reseed are not revoked and stay valid until they expire.
- Sending is simulated: "Mark as sent" records the message in the app. Nothing is delivered to WhatsApp.

## Scope and what's next

Not built: real WhatsApp sending and receiving, payments, analytics, signup, password reset. Next: WhatsApp Business API integration, a scheduled daily digest per rep, learning from sent-message outcomes, per-team tuning of the rubric, DOM/E2E tests, and an atomic "mark sent" done in a single database function.
