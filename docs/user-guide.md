# User guide

A short guide for the two groups who use PSG Hub Surveys: PSG staff, and the people at each shop. The package asks for training on the verified screens (09, handoff checklist); use this guide with a walkthrough on an internal test shop.

## Signing in

Go to the Hub address and sign in with your email and password. *Keep me logged in* remembers your email on this device, never your password. *Forgot password?* sends a reset link that works for one hour. After a few wrong attempts the sign-in waits briefly before you can try again.

## For shop users

You see your own shop only.

### Survey dashboard

The first page after sign-in.

- **Date range:** choose *30 days*, *90 days* or *12 months* at the top. **Filters** opens a small panel for the date basis (date submitted or date the vehicle was delivered), exact dates, source (online link, paper, public form), survey version and an answer (for example *2 or lower* on a rating). **Reset** returns to the default of the last 90 days.
- **The five numbers:** submitted, counted in scores, pending customer match, with negative feedback, and started but not submitted.
- **Responses over time:** submitted and counted responses per day, week or month, depending on the range. Point at a dot to see its number, or open *Show as table*.
- **Where responses came from** and **What counts in the scores:** a response counts once it is matched to its repair visit. Pending matches, duplicates, legacy records and test data never change a score, and the page says how many were left out.
- **Scores:** each score's average and its trend. Survey versions are never averaged together, because their questions can differ.
- **Question results:** how customers answered each question: a count and share for every rating value and choice, a table for grids, the range for numbers and the newest comments. Click any answer to see only the customers who gave it: the whole page, the list and the export follow, and the line at the top names the filter with *Show all answers* to clear it.
- **Responses:** every response, newest first, 10 to a page. The tabs above the list show *All*, *Counted*, *Pending match*, *Negative feedback* or *Not counted*. Open a response to read its answers. Results appear as soon as the customer submits, including negative ones.
- **Export CSV:** downloads every response in the current dates and filters (including an answer filter), one row each, with whether it counts. The list tabs do not narrow the export: use the *Counted* column to filter it in a spreadsheet.

### Follow-up

When PSG sends you negative feedback to follow up, it appears under **Follow-up**. Open the case, add notes about what you did, and choose **Ask PSG to close this** once the customer is taken care of. PSG confirms the final resolution.

### Changes to your shop

Branding, timing and alert recipients are set by PSG. Ask your PSG contact for a change.

## For PSG staff

The sidebar lists every screen. Lists are paged (10 or 20 items a page; some let you choose up to 50), keep your filters when you change page, and leave internal test data out of the operator queues unless you choose *Include test data*.

| Screen | Use it to |
| --- | --- |
| Overview | The whole project at a glance: responses per month, sources, matching, negative feedback, email, the busiest shops and system health. Production only; *Include test data* adds internal test and demo data |
| Operator queues | Work everything that failed or waits for a person, oldest first: held invitations, file rows that never became a visit, email problems, failed jobs, pending matches and suppression changes. Take ownership; mark a failed job or a file row reviewed with what you did |
| Dashboard | See any shop's results exactly as that shop sees them |
| Shops | Search by name or public link, filter by mode and type, sort, and export the list as CSV. *Add shop* opens a popup (the success message links to the new shop). On a shop, set branding, cutoff, survey version, timing, alert recipients, shop users and shop-only questions. *Link* and *QR code* open the public survey link and its QR code (download as PNG or SVG). *Delete* asks Yes or No first |
| Launch readiness | Check every shop's launch checklist, record manual checks with a note, and export the whole manifest as CSV. A shop's first switch to Live needs every check |
| Surveys | Build and preview a survey, publish a TEST or verified version, create test links. *Create new survey* starts a blank survey or, under *Copy a survey*, a draft copy of any version of an existing one |
| Imports | Upload a shop's customer file, legacy survey history, legacy cases or existing opt-out list; review the dry-run preview row by row, then commit. Files that could not be read are listed with the reason |
| Invitations | See each visit's invitation: ready, waiting, held (with the reason), excluded or sent; fix details or print a link and QR code |
| Responses | Enter a paper survey, match responses to visits, settle duplicates (both answer sets side by side, differences highlighted), correct answers (the original is kept) |
| Alert review | Review negative feedback, choose recipients, approve and send, resolve cases |
| Legacy cases | Take over open cases from the old system, once, with a note |
| Suppression queue | Apply routine-mail changes in FileMaker by hand and acknowledge each one |
| Email review | Settle emails whose result is unknown, bounced or failed |
| FileMaker bridge | See whether writes to FileMaker are on, record the go-live checks, and track retirement |
| Test recipients | The only addresses that Test-mode shops may email |

### Good habits

- Nothing is sent just because you fixed a record or switched a shop to Live. Sending is always a separate, deliberate step.
- A shop in Test mode never emails a customer, and its answers never count in reports.
- Every change is recorded with who made it and when.
- Deleting a shop removes it from every list and screen, but keeps its responses, cases, emails and history. A Live shop must be paused first, and nothing may still be waiting to send.
- When an email's result is unknown, check the provider before resending; a resend could reach the customer twice.

Day-to-day order of work, monitoring and recovery are in the [operations runbook](operations-runbook.md).
