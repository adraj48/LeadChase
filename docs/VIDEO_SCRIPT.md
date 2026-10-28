# Video script (target 2:45, hard limit 3:00)

Lead names are from `scripts/seed-data.ts`. The app opens straight on the dashboard, viewing as Sneha Iyer (rep4), who has 5 hand-written leads. There is no login.

| Time | On screen | Click | Say |
| --- | --- | --- | --- |
| 0:00-0:10 | Title or the dashboard | Nothing | "Sales reps lose deals because they don't know who to follow up with today. I built an agent that answers that in ten seconds." |
| 0:10-0:20 | Live link, dashboard | Open the live link; point at "Viewing as: Sneha Iyer" in the header | "This is the live app. Login was out of scope, so it opens straight on the dashboard. I'm viewing as Sneha, one of five reps." |
| 0:20-0:40 | Today screen, headline | Point at the headline, then the red Overdue group | "The headline says what needs me today. Overdue is red, and inside each group Hot leads come first; then due today, then upcoming. Each row shows the tag and the agent's reason." |
| 0:40-1:05 | Harpreet Singh Bedi, Bedi Logistics (Hot, overdue 8 days) | Hover, then click the row: the detail opens instantly | "Leads open instantly. Harpreet agreed a price for two machines and said he would confirm next day. Then nine days of silence, so his follow-up is eight days overdue. The agent keeps him Hot and the reason cites the chat." |
| 1:05-1:25 | Draft box, Draft with agent | Click Draft with agent; let the reply type itself in word by word | "Draft with agent writes the next WhatsApp message from the chat, in Harpreet's Hinglish, using only facts from the chat. Nothing is saved until I choose." |
| 1:25-1:40 | Draft box, Mark as sent | Edit one word, click Mark as sent | "I can edit it. Mark as sent saves it to the chat and the agent sets the next follow-up." (Show the toast "Sent. Next follow-up: ..." and the new date.) |
| 1:40-2:10 | Anjali Deshmukh, Deshmukh Dairy (Cold, no reply for weeks) | Click her row, add a buyer message: "Yes, plan is back on. Please send the price and delivery time.", click Add to chat | "Anjali went quiet after the quote, so she's Cold. When she replies asking for price and delivery, the tag updates at once, and a moment later the agent re-reads the chat: now she's Hot, with a new reason, a fresh draft and a follow-up within a day." (Wait for the draft box to fill.) |
| 2:10-2:20 | Add lead pop-up | Click + Add lead, fill the form, submit | "Adding a lead takes five fields. The agent tags it and writes a first message." |
| 2:20-2:35 | All reps view | Switch "Viewing as" to All reps; show the Hot, Warm and Cold counts and the Rep label on a card | "Switching to All reps gives the team view: every rep's leads, tag counts, and who owns each one." |
| 2:35-2:45 | Any screen | Nothing | "The model sets the tag and draft; dates are handled in code, and if Gemini fails, simple rules take over. Thanks for watching." |

Other seed leads worth knowing if you improvise (view as Vikram Singh, rep5): Neha Gupta, FreshBite Snacks (Cold, buyer said "not this year, maybe check in the new year"); Imran Qureshi, Qureshi Garments Exports (Hot, asked for bank details to pay advance).

## Before you record

- [ ] Run `npm run seed` the same day, so overdue and due-today items exist.
- [ ] Open the live site once beforehand to wake the free Supabase project.
- [ ] Test the Gemini key: click Draft with agent on any lead and confirm there is no "rule-based" label.
- [ ] Use a clean browser window at 100% zoom with the bookmarks bar hidden.
- [ ] Rehearse once with a timer. Keep the final video under 3:00 (the hard limit); cut the add-lead step or the All reps view first if you run long.
- [ ] After recording, run `npm run seed` again to reset the data.
