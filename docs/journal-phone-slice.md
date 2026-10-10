# Phone capture: journals, grades, recognition, family responses

The current development path uses the existing React web app on Abby's iPhone. No Mac is required for this slice. Unity companion presentation follows once capture and family interaction work well on her phone.

## Try the flow

Apply the new Django migrations when preparing a development environment (`python manage.py migrate`). They add journal request IDs, memory responses, grade recognition counters, and a notification type. A replacement initial migration also repairs the pre-existing fresh-database user-model failure without changing the original deployed migration files. Real SQLite and PostgreSQL migration fixtures verify fresh setup and preservation of existing users, auth relationships, schema, and data; the browser preview and ordinary model/API tests still use syncdb. Production migrations run through the existing deployment process; local validation uses isolated data.

1. Sign in as a child and open **Chronicle → Journal → Write today's entry**. Quick Actions opens the same form.
2. Type a thought, close the form, and reopen it. A saved device draft survives a reload. If browser storage is unavailable, the form warns before discarding unsaved words. Device drafts are separated by account; they are not server backups.
3. Choose **Share with my family** when appropriate. The default is **Only you**. Save the entry.
4. Read the confirmation and tap **Done**. The paw reacts to confirmed XP. The displayed amount comes from a persisted award receipt, including boosts and actual skill eligibility; unavailable rewards are described without inventing an amount.
5. Sign in as a family parent. Shared entries appear in Journal and Yearbook. Open **Family responses**, write encouragement, and send it.
6. Sign back in as the child. A reply notification returns to Journal, where the conversation stays attached to the memory. Both child and parents can respond. Reading, editing, sharing, and replying do not generate another journal reward.
7. Reopen the memory in Yearbook later. Historical journal text remains locked under the existing daily-journal rule, but its owner can still change sharing.

## Try grade capture

1. Open **Chronicle → Grades → Log a grade**, or choose **Log a grade** from Quick Actions.
2. Enter the subject, what was graded, and the date received. Choose **Percentage**, **Points**, or **Letter** and enter the result as it was recorded. Zero is valid; points can include extra credit. The app does not convert results to GPA or infer a letter grade.
3. Add an optional reflection, such as something learned or a next step. Close and reopen the form to check draft recovery. The default is **Only you**; explicitly choose **Share with my family** to invite responses.
4. Save and read the confirmation. The first grade captured on each local save day is eligible for a fixed 10 XP pool routed to Time Management, regardless of its mark or assessment date. Boosts and actual skill eligibility affect the verified receipt. Additional results can always be saved, with an honest daily-limit message and no repeat award.
5. Tap **Done** to return to history. **Load earlier grades** retrieves additional pages. An owner can use **Correct grade or sharing** at any time, including for historical results; corrections and replies do not award XP.
6. As a parent, choose the child in **Grades for**. Only their shared results appear. Open **Family responses** to encourage them or discuss a next step. The child's reply notification opens the Grades tab.
7. Revisit the same result and conversation in **Yearbook**. A birthday or school-year anchor is not required to read saved memories.

Grade drafts are separated by account and by the entry being corrected. Saves retain an immutable request before sending. **Check save** retries the same request and retrieves its original reward receipt after an uncertain connection; it does not award again, even after midnight or after a correction. A missing skill catalog or failed award leaves the grade saved with an unavailable receipt. The first capture attempt consumes that day's recognition allowance even if its award is unavailable; automatic recovery of failed awards is not implemented. No money, coins, drops, streak credit, or companion growth is claimed by the grade receipt.

## Interrupted connections

Drafts retain the exact pending submission and its request ID before a save begins. A missing or stalled response offers **Check save**, which repeats the same request. The server returns the saved entry and its original XP receipt without issuing another award. This works across midnight and after the app reopens. Different text cannot reuse an already submitted journal ID. Replies use the same once-per-request principle and retain their drafts on failures.

The existing daily journal is still one entry per day; the child can add to it during that day. Grade capture is independent and allows multiple results each day. Other memory formats are later capture flows. Reward failures preserve the entry and return an unavailable receipt; automatic recovery of failed rewards is not implemented. Streak/drop/quest hooks retain their existing best-effort behavior and are not presented as confirmed currency in the journal receipt.

## Sharing and archive behavior

Private journals and grades are owner-only through REST and MCP. Shared entries and their conversations are visible to the author and same-family parents; siblings and other families cannot read them. Returning an entry to **Only you** hides its conversation from parents. It cannot undo anything someone already read. Existing private journal rows become owner-only too, until their authors share them. Notifications contain no journal, grade, or reply content.

Journal and conversation reads require a connection. The service worker no longer falls back to cached Chronicle API responses, because those could bypass a sharing change or account switch. Device capture drafts remain available offline; they must be saved to the server to become archive memories.

Lifetime export still needs journal text, structured grades, original photos/audio, and family responses added to the existing portfolio export. Grade trends, additional memory capture, world decorations, and owned-companion progression are additional slices.

## Validation boundary

Backend tests use disposable databases and cover real API saves/retries, grade formats and corrections, daily recognition limits, XP receipt rollback, sharing across REST/MCP, family boundaries, reply notifications, and history. PostgreSQL race tests verify that simultaneous retries preserve one grade and its original receipt, and simultaneous distinct captures save both grades while awarding recognition once. Frontend tests cover draft restoration, ambiguous saves, paginated grade history, response threads, sharing, retained-tab refreshes, and correction drafts against updated records. The completed 393 × 852 browser walkthrough verifies draft recovery, verified recognition, later zero-score capture after the daily reward limit, corrections updating Yearbook, parent sharing/child selection, family responses, and keyboard activation of a reply notification returning to Grades. Abby's actual iPhone and a native iOS build still need validation.
