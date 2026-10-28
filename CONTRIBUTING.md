# Contributing

## Setup

Follow "Getting started" in the [README](README.md). You need Node.js 24 (see
`.nvmrc`), a Supabase project and, optionally, a Gemini API key (without one the
rule-based fallback is used).

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>` or `docs/<topic>`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
   messages, for example `fix: clamp follow-up gap for Cold leads`.
3. Run the checks before opening a pull request:

   ```bash
   npm run check     # lint + typecheck + tests
   npm run build     # needs NEXT_PUBLIC_SUPABASE_* set (dummy values are fine)
   ```

4. Open a pull request and fill in the template. Keep changes focused, and add
   or update tests for behavior changes.

Never commit `.env*` files or secrets. Dates are computed in code in
`Asia/Kolkata`; keep that logic out of the model prompt.
