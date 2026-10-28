# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub security advisories:
**Security > Report a vulnerability** on this repository. Do not open a public
issue for a suspected vulnerability.

Include the affected area, steps to reproduce and the impact you observed. You
can expect an acknowledgement within a few days.

## Scope

LeadChase is a demo project. All data in the seeded database is fictional, and
the app has no authentication by design (the brief lists login as out of scope):
anyone with the URL can view and change the demo data through the API. Reports
that only restate this are not vulnerabilities. In scope: exposure of the service
role key or Gemini key to the browser, writes that bypass the server API's
validation, `anon` access beyond reading `public.leads`, and other secret handling
or row level security issues.
