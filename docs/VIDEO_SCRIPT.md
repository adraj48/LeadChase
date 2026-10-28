# Video script (target 2:30, hard limit 3:00)

Lead names are from `scripts/seed-data.ts`. Demo rep is `rep4@axon.demo` (Sneha Iyer); password `demo1234` for all accounts.

| Time | On screen | Click | Say |
| --- | --- | --- | --- |
| 0:00-0:10 | Title or the login page | Nothing | "Sales reps lose deals because they don't know who to follow up with today. I built an agent that answers that in ten seconds." |
| 0:10-0:25 | Live link, login page | Open the live link, log in as `rep4@axon.demo` | "This is the live app. I'm Sneha, a rep. Each rep sees only their own leads." |
| 0:25-0:45 | Today screen, headline | Point at the headline, then the red Overdue group | "The headline says what needs me today. Overdue is red and sorted most overdue first, then due today, then upcoming. Each row shows the tag and the agent's reason." |
| 0:45-1:10 | Harpreet Singh Bedi, Bedi Logistics (Hot, overdue) | Click the row | "Harpreet agreed a price for two machines and said he would confirm next day. Then nine days of silence. The agent keeps him Hot and the reason cites the chat. The draft nudges him with a clear yes or no ask." |
| 1:10-1:30 | Draft box, Mark as sent | Edit one word in the draft, click Mark as sent (the button reads "Sending…" while the agent works) | "I can edit the draft. Mark as sent saves it to the chat and the agent sets the next follow-up." (Show the toast "Sent. Next follow-up: ..." and the new date.) |
| 1:30-2:00 | Anjali Deshmukh, Deshmukh Dairy (Cold, no reply for weeks) | Click her row, add a buyer message: "Yes, plan is back on. Please send the price and delivery time." | "Anjali went quiet, so she's Cold. When she replies asking for price and delivery, the agent re-reads the chat: now she's Hot, with a new reason, a new draft and a follow-up within a day." |
| 2:00-2:15 | Add lead pop-up | Click + Add lead, fill the form, submit | "Adding a lead takes five fields. The agent tags it and writes a first message." |
| 2:15-2:30 | Owner login | Log out, log in as `owner@axon.demo`; show the tag counts, then pick a rep in the Rep filter (it lists the five reps, not the owner) | "The owner sees every rep's leads, Hot, Warm and Cold counts, and a rep filter." |
| 2:30-2:45 | Any screen | Nothing | "The model sets the tag and draft; dates are handled in code, and if Gemini fails, simple rules take over. It runs on add lead, add message and mark sent. Thanks for watching." |

Other seed leads worth knowing if you improvise: Neha Gupta, FreshBite Snacks (rep5, Cold, buyer said "not this year, maybe March"); Imran Qureshi, Qureshi Garments Exports (rep5, Hot, asked for bank details to pay advance).

## Before you record

- [ ] Run `npm run seed` the same day, so overdue and due-today items exist.
- [ ] Open the live site once beforehand to wake the free Supabase project.
- [ ] Test the Gemini key: add a message to a lead and confirm the tag changes without the "rule-based suggestion" note.
- [ ] Use a clean browser window at 100% zoom with the bookmarks bar hidden.
- [ ] Rehearse once with a timer. Keep the final video under 3:00 (the hard limit); cut the owner view or the add-lead step first if you run long.
- [ ] After recording, run `npm run seed` again to reset the data.
