import type { TourStep } from "./tour";

// The top bar is on every page; the two landing pages introduce it.
const TOP_BAR_STEPS: TourStep[] = [
  { target: "form[role=\"search\"]", title: "Search", text: "Type a shop, survey, page or customer and press Enter to find it." },
  { target: "button[aria-label^=\"Notifications\"]", title: "Notifications", text: "The red number counts work waiting for you. Click the bell to see it and go straight there." },
];

const DASHBOARD_STEPS: TourStep[] = [
  { target: "[data-tour=\"filters\"]", title: "Filters", text: "Choose the date basis, dates, source, survey version and an answer. Apply keeps the rest of the page in step." },
  { target: "[data-tour=\"range\"]", title: "Quick date ranges", text: "Jump to the last 30 days, 90 days or 12 months." },
  { target: "[data-tour=\"export\"]", title: "Export CSV", text: "Download the responses in this view, with the same filters, as a spreadsheet file." },
  { target: "[data-tour=\"counts\"]", title: "Response counts", text: "Submitted surveys, those counted in scores, those waiting for a customer match, those with negative feedback and partial surveys." },
  { target: "[data-tour=\"volume\"]", title: "Responses over time", text: "Submitted against counted in scores. Hover the chart to see each period." },
  { target: "[data-tour=\"mix\"]", title: "Sources and what counts", text: "Where responses came from, and why some are not in the scores yet." },
  { target: "[data-tour=\"scores\"]", title: "Survey performance", text: "Average score for each measure, with the change against the first half of the period." },
  { target: "[data-tour=\"questions\"]", title: "Question results", text: "How customers answered each question. Click an answer to see only those customers, everywhere on this page and in the export." },
  { target: "[data-tour=\"versions\"]", title: "Other survey versions", text: "Each survey version is scored on its own. Open one to see its scores." },
  { target: "[data-tour=\"list\"]", title: "Responses", text: "Every response in this view. Use the tabs to show only counted, pending or negative ones, and View to open one." },
  { target: "[data-tour=\"history\"]", title: "Earlier survey history", text: "Results from the earlier survey system, shown on their own scales and never mixed into the scores." },
];

/** Page tours by route; the first match wins. `target` is a CSS selector for the part to highlight. */
export const TOURS: { id: string; path: RegExp; steps: TourStep[] }[] = [
  // PSG workspace
  {
    id: "search",
    path: /^\/psg\/search$/,
    steps: [
      { target: "[aria-labelledby=\"search-Pages\"]", title: "Pages", text: "Workspace pages whose name matches. Click one to open it." },
      { target: "[aria-labelledby=\"search-Shops\"]", title: "Shops", text: "Shops whose name or public link matches." },
      { target: "[aria-labelledby=\"search-Surveys\"]", title: "Surveys", text: "Surveys whose name or key matches." },
      { target: "[aria-labelledby=\"search-lists\"]", title: "Search the lists", text: "Customers, emails, visits and cases are in these lists. Each button opens one already filtered by your words." },
    ],
  },
  {
    id: "shop-search",
    path: /^\/shop\/[^/]+\/search$/,
    steps: [
      { target: "main h1", title: "Search", text: "Results for the words you typed in the search box at the top." },
      { target: "main ul[aria-label=\"Search results\"]", title: "Results", text: "Your pages and follow-up cases that match. Click one to open it." },
    ],
  },
  {
    id: "overview",
    path: /^\/psg$/,
    steps: [
      ...TOP_BAR_STEPS,
      { target: "[data-tour=\"test-data\"]", title: "Production or test data", text: "Numbers show production data only. Switch here to include internal test and demo shops." },
      { target: "[data-tour=\"kpis\"]", title: "Headline numbers", text: "Responses over the last 12 months, this month against last month, the share matched to a visit and negative feedback." },
      { target: "[data-tour=\"work\"]", title: "Work waiting", text: "Active shops, operator items and alerts that need review. Click a tile to open that queue." },
      { target: "[data-tour=\"trend\"]", title: "Responses trend", text: "Submitted, matched and negative responses month by month. Hover a point to see its numbers." },
      { target: "[data-tour=\"sources\"]", title: "Where responses came from", text: "How many came from the emailed link, paper forms and the public form." },
      { target: "[data-tour=\"months\"]", title: "Month by month", text: "The latest month for responses, negative feedback, survey emails and match rate, with the last 12 months as bars." },
      { target: "[data-tour=\"pipelines\"]", title: "Matching, alerts and email", text: "Where each piece of work stands. Use the links to match responses, review alerts or check email." },
      { target: "[data-tour=\"top-shops\"]", title: "Busiest shops", text: "Shops with the most responses in the last 90 days. The arrow opens that shop’s dashboard." },
      { target: "[data-tour=\"recent-alerts\"]", title: "Recent alerts", text: "The newest negative feedback. Click one to review it." },
      { target: "[data-tour=\"health\"]", title: "System health", text: "Survey email, the background worker and the FileMaker bridge. Red means someone should take a look." },
    ],
  },
  {
    id: "operations",
    path: /^\/psg\/operations$/,
    steps: [
      { target: "main form[aria-label=\"Scope\"]", title: "Scope", text: "Limit the whole page to one shop or to items raised in a recent period." },
      { target: "main nav[aria-label=\"Queues\"]", title: "Queues", text: "Each tab is one kind of work waiting for a person. The number shows how many items are open." },
      { target: "main form[aria-label=\"Search and filter this queue\"]", title: "Search and filter", text: "Find an item by text, or narrow the list by owner and status. Sort to see the most overdue first." },
      { target: "main [role=\"group\"][aria-label=\"Owner\"]", title: "Whose items", text: "Switch between everyone's items, your own and items nobody owns yet." },
      { target: "main [role=\"switch\"]", title: "Hide test data", text: "Keep internal test items out of the list. Turn it off to see them too." },
      { target: "main nav[aria-label=\"Operator queue pages\"]", title: "More pages", text: "Move through the rest of the queue here." },
      { target: "main aside[aria-label=\"Queue summary\"]", title: "Queue summary", text: "How the open work splits by queue and by age, and how long items have waited. Use it to spot a backlog early." },
    ],
  },
  {
    id: "shop-detail",
    path: /^\/psg\/shops\/[^/]+$/,
    steps: [
      { target: "[aria-labelledby=\"mode-heading\"]", title: "Mode", text: "Whether this shop is in test, live or paused. Only live shops send surveys to real customers." },
      { target: "[aria-labelledby=\"readiness-heading\"]", title: "Launch readiness", text: "Everything the shop needs before it goes live. Work through each item until the list is complete." },
      { target: "[aria-labelledby=\"legacy-heading\"]", title: "Legacy survey history", text: "Confirm how the shop's surveys from the earlier system are covered, so no customer is surveyed twice." },
      { target: "[aria-labelledby=\"additions-heading\"]", title: "Shop questions", text: "Extra questions asked only for this shop. They are shown with the answers but never scored." },
      { target: "main section[aria-label=\"Settings\"]", title: "Settings", text: "The shop's survey version, time zone, reminder timing, alert recipients and branding. Changes are recorded in the history below." },
      { target: "[aria-labelledby=\"members-heading\"]", title: "Shop users", text: "People who can sign in to this shop's workspace. Add or remove them here." },
      { target: "[aria-labelledby=\"history-heading\"]", title: "Settings history", text: "Every activation and settings change, with who made it and when." },
    ],
  },
  {
    id: "shops",
    path: /^\/psg\/shops$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "Total shops, live shops, shops in test or paused, and total responses, each with its trend." },
      { target: "main nav[aria-label=\"Quick filters\"]", title: "Quick filters", text: "Show shops in one mode, or only internal test or production shops, with one click." },
      { target: "main table", title: "Shop list", text: "Every shop with its mode, public survey link and recent responses. Use the actions to open or manage a shop." },
      { target: "main form[aria-label=\"Page size\"]", title: "Rows per page", text: "Choose how many shops to show at once." },
      { target: "main nav[aria-label=\"Shop pages\"]", title: "More pages", text: "Move through the rest of the shop list here." },
    ],
  },
  {
    id: "survey-test-response",
    path: /^\/psg\/instruments\/[^/]+\/responses\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Test response", text: "A response sent through a test link. It is test data and never counts in any shop's scores." },
      { target: "[aria-labelledby=\"outcomes\"]", title: "Computed results", text: "The scores, alerts and suppression actions the survey rules produced for these answers. Check them against what you expected." },
    ],
  },
  {
    id: "survey-builder",
    path: /^\/psg\/instruments\/[^/]+\/edit$/,
    steps: [
      { target: "main header", title: "Save and publish", text: "The draft saves when you click Save draft. Publish when it is ready. A published version can never be changed." },
      { target: "main [role=\"tablist\"][aria-label=\"Builder sections\"]", title: "Builder sections", text: "Switch between questions, scoring, alert rules, suppression rules and a preview of the survey." },
      { target: "main section[aria-label=\"Question types\"]", title: "Question types", text: "Drag a question type onto a page, or click it to add it after the selected question." },
      { target: "main nav[aria-label=\"Survey outline\"]", title: "Survey outline", text: "Every page and question in order. Select one to edit it, or drag to reorder." },
      { target: "main section[aria-label=\"Editor\"]", title: "Editor", text: "Change the wording, options and settings of whatever you selected in the outline." },
      { target: "main aside[aria-label=\"Preview results\"]", title: "Preview results", text: "Fill in the preview to see the scores and alerts your answers would produce." },
    ],
  },
  {
    id: "survey-detail",
    path: /^\/psg\/instruments\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Survey", text: "The survey's name and key. Its versions and content are below." },
      { target: "main nav[aria-label=\"Versions\"]", title: "Versions", text: "Each published version stays exactly as it was. Pick one to see its questions and rules." },
      { target: "main section[aria-label=\"Version details\"]", title: "Version details", text: "When this version was published, where its content came from and whether it is for testing only." },
      { target: "[aria-labelledby=\"test-links\"]", title: "Test links", text: "Create a link to try this version yourself. Test responses never count in any shop's scores." },
    ],
  },
  {
    id: "surveys",
    path: /^\/psg\/instruments$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "Total surveys, how many have a published version, and how many are drafts or test only." },
      { target: "main form[aria-label=\"Find surveys\"]", title: "Find surveys", text: "Search by name, or narrow the list by status and type. Sort to change the order." },
      { target: "main nav[aria-label=\"Quick filters\"]", title: "Quick filters", text: "Filter the list by status with one click." },
      { target: "main table", title: "Survey list", text: "Every survey with its latest version and status. Use the actions to view or edit one." },
      { target: "main form[aria-label=\"Page size\"]", title: "Rows per page", text: "Choose how many surveys to show at once." },
      { target: "main nav[aria-label=\"Survey pages\"]", title: "More pages", text: "Move through the rest of the survey list here." },
      { target: "[aria-labelledby=\"new-survey\"]", title: "New survey", text: "Start a new survey here. It begins as a draft you can build and test before publishing." },
    ],
  },
  {
    id: "paper-entry",
    path: /^\/psg\/responses\/paper$/,
    steps: [
      { target: "main ol[aria-label=\"Steps\"]", title: "Steps", text: "Where you are in the entry. Choose the shop, find the visit, enter the answers, then save." },
      { target: "#shop", title: "Choose the shop", text: "Pick the shop the paper form came from, then click Use this shop." },
      { target: "#visit-search", title: "Find the visit", text: "Search by visit ID, repair order number or last name. Without a visit, the response waits for a customer match." },
      { target: "#paper-entry", title: "Enter the answers", text: "Add the date the form arrived and type each answer exactly as written." },
      { target: "main aside[aria-label=\"Survey entry\"]", title: "Survey entry", text: "Shows what is still required and who is entering the form. Save from here when everything is filled in." },
    ],
  },
  {
    id: "response-detail",
    path: /^\/psg\/responses\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Response", text: "One customer's survey response. The details below show the shop, visit and how it was received." },
      { target: "[aria-labelledby=\"decision-heading\"]", title: "Decision needed", text: "This response needs a person to match it to a visit, confirm the shop or settle a duplicate. Make the choice here." },
      { target: "[aria-labelledby=\"outcomes-heading\"]", title: "Scores and alerts", text: "The current scores and any negative feedback alerts from these answers." },
      { target: "[aria-labelledby=\"answers-heading\"]", title: "Answers", text: "Every answer the customer gave. Corrections are made here and saved as a new revision." },
      { target: "[aria-labelledby=\"history-heading\"]", title: "History", text: "Every change to this response, with who made it and when." },
    ],
  },
  {
    id: "responses",
    path: /^\/psg\/responses$/,
    steps: [
      { target: "main nav[aria-label=\"Response queues\"]", title: "Response queues", text: "Switch between all responses and those waiting for a customer match, a shop confirmation or another review." },
      { target: "main form[aria-label=\"Find responses\"]", title: "Find responses", text: "Search, or narrow the list by source, whether it counts and date range." },
      { target: "main table", title: "Response list", text: "Each response with its shop, source and status. Tick rows to export them, or click View to open one." },
      { target: "main form[aria-label=\"Page size\"]", title: "Rows per page", text: "Choose how many responses to show at once." },
      { target: "main nav[aria-label=\"Response pages\"]", title: "More pages", text: "Move through the rest of the responses here." },
    ],
  },
  {
    id: "alert-detail",
    path: /^\/psg\/alerts\/[^/]+$/,
    steps: [
      { target: "main section[aria-label=\"Case status\"]", title: "Where it stands", text: "Whether the shop can see it, the review decision, the alert email and the follow-up, at a glance." },
      { target: "[aria-labelledby=\"alerts-heading\"]", title: "What fired", text: "The answers that triggered this alert. Read them before you decide." },
      { target: "[aria-labelledby=\"review-heading\"]", title: "Review", text: "Approve the alert to email the shop, or dismiss it. Check the recipients before you send." },
      { target: "[aria-labelledby=\"approvals-heading\"]", title: "Approvals and delivery", text: "Who approved the alert, who it went to and whether each email was delivered." },
      { target: "[aria-labelledby=\"notes-heading\"]", title: "Notes and follow-up", text: "Add notes for PSG only or for the shop, and resolve the case once it is followed up." },
    ],
  },
  {
    id: "alerts",
    path: /^\/psg\/alerts$/,
    steps: [
      { target: "main nav[aria-label=\"Alert queues\"]", title: "Alert queues", text: "Switch between alerts that need review, open follow-up, closure requests, resolved and dismissed." },
      { target: "main form[aria-label=\"Find alerts\"]", title: "Find alerts", text: "Search by shop name or alert reason, or narrow the list to one shop. Sort to change the order." },
      { target: "main table", title: "Alert list", text: "Each negative feedback case with its shop and reason. Open one to review it." },
      { target: "main nav[aria-label=\"Alert pages\"]", title: "More pages", text: "Move through the rest of the alerts here." },
      { target: "main aside[aria-label=\"Alert summary\"]", title: "Alert summary", text: "How all alert cases split by status, the reasons that fire most and what to do next." },
    ],
  },
  {
    id: "dashboard",
    path: /^\/psg\/dashboard$/,
    steps: [{ target: "[data-tour=\"shop\"]", title: "Choose a shop", text: "Pick any shop to see its dashboard exactly as that shop sees it. Your filters stay as they are." }, ...DASHBOARD_STEPS],
  },
  {
    id: "readiness",
    path: /^\/psg\/readiness$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "How many shops are ready to launch, not ready yet, or not in scope, out of all shops." },
      { target: "[aria-labelledby=\"email-heading\"]", title: "Email sending", text: "Checks for survey email that every shop relies on. These must pass before any shop can go live." },
      { target: "[aria-labelledby=\"shops-heading\"]", title: "Shop readiness", text: "Each shop and the items it still needs before launch." },
      { target: "main form[aria-label=\"Find a shop\"]", title: "Find a shop", text: "Search the list by shop name." },
      { target: "[aria-labelledby=\"shops-heading\"] table", title: "Readiness list", text: "Each shop's mode and progress. Click Checklist to finish its missing items." },
      { target: "main nav[aria-label=\"Readiness pages\"]", title: "More pages", text: "Move through the rest of the shops here." },
    ],
  },
  {
    id: "import-detail",
    path: /^\/psg\/imports\/[^/]+$/,
    steps: [
      { target: "main section[aria-label=\"Row outcomes\"]", title: "Row outcomes", text: "How many rows were created, matched to existing records, held, excluded or rejected." },
      { target: "[aria-labelledby=\"mapping-heading\"]", title: "Columns", text: "Match each column in the file to the right field. Check this before you commit." },
      { target: "[aria-labelledby=\"commit-heading\"]", title: "Commit", text: "Save the rows once there are no problems left. This shows how many visits could be surveyed." },
      { target: "[aria-labelledby=\"rows-heading\"]", title: "Rows", text: "What happens to each row in the file, and why any row was held or rejected." },
      { target: "main nav[aria-label=\"Import row pages\"]", title: "More pages", text: "Move through the rest of the rows here." },
    ],
  },
  {
    id: "imports",
    path: /^\/psg\/imports$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "Visit rows created, found as duplicates, held for review, and excluded or failed." },
      { target: "[aria-labelledby=\"history-heading\"]", title: "Import history", text: "Every file imported so far, with how many rows were created, held or rejected. Click View to open one." },
      { target: "main form[aria-label=\"Import list order\"]", title: "Order", text: "Show the newest or the oldest imports first." },
      { target: "main nav[aria-label=\"Import pages\"]", title: "More pages", text: "Move through the rest of the import history here." },
      { target: "[aria-labelledby=\"rejected-files\"]", title: "Unreadable files", text: "Files that could not be read at all. Fix the file and upload it again." },
      { target: "[aria-labelledby=\"new-import\"]", title: "New import", text: "Choose the shop and source system, then upload a file of repair visits." },
    ],
  },
  {
    id: "invitations",
    path: /^\/psg\/invitations$/,
    steps: [
      { target: "#shop-picker", title: "Choose a shop", text: "Pick the shop whose repair visits you want to see." },
      { target: "main section[aria-label=\"Shop details\"]", title: "Shop details", text: "The shop's time zone and survey version, which decide when and what each customer is sent." },
      { target: "main nav[aria-label=\"Queue\"]", title: "Queue", text: "Switch between visits ready to send, waiting for Live, held, excluded and sent." },
      { target: "main form[aria-label=\"Find visits\"]", title: "Find visits", text: "Search by name, visit ID or email, or limit the list to a recent period." },
      { target: "main table", title: "Visit list", text: "Each visit and whether it can be surveyed. Tick visits and click Send selected to email their surveys." },
      { target: "main nav[aria-label=\"Invitation pages\"]", title: "More pages", text: "Move through the rest of the visits here." },
    ],
  },
  {
    id: "legacy-case",
    path: /^\/psg\/legacy-cases\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Legacy case", text: "A follow-up case from the earlier system. Its current state is shown beside the title." },
      { target: "[aria-labelledby=\"legacy-record\"]", title: "Legacy record", text: "The case as recorded in the earlier system. It is read-only here." },
      { target: "[aria-labelledby=\"hub-followup\"]", title: "Hub follow-up", text: "Take the case over once its legacy owner has stopped, then add notes and resolve it here." },
    ],
  },
  {
    id: "legacy-cases",
    path: /^\/psg\/legacy-cases$/,
    steps: [
      { target: "main nav[aria-label=\"Legacy case states\"]", title: "Case states", text: "Switch between cases still with the legacy owner, followed up in Hub, resolved in Hub and closed in the legacy system." },
      { target: "main form[aria-label=\"Find cases\"]", title: "Find cases", text: "Search cases by shop or issue." },
      { target: "main table", title: "Case list", text: "Each legacy case with its shop and state. Click View to open one." },
      { target: "main nav[aria-label=\"Legacy case pages\"]", title: "More pages", text: "Move through the rest of the cases here." },
      { target: "main aside[aria-label=\"About legacy cases\"]", title: "About legacy cases", text: "How cases from the earlier system arrive and when to take one over." },
    ],
  },
  {
    id: "suppression",
    path: /^\/psg\/suppression$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "Queues with work, outstanding and acknowledged requests, and how old the oldest one is." },
      { target: "main nav[aria-label=\"Suppression queues\"]", title: "Queues", text: "Switch between changes still to apply in FileMaker and those already acknowledged." },
      { target: "main form[aria-label=\"Find changes\"]", title: "Find changes", text: "Search, or narrow the list by type of change, shop and date." },
      { target: "main table", title: "Change list", text: "Each mailing change to make in FileMaker. Record the result once you have applied it." },
      { target: "main nav[aria-label=\"Suppression pages\"]", title: "More pages", text: "Move through the rest of the changes here." },
    ],
  },
  {
    id: "email-review",
    path: /^\/psg\/email$/,
    steps: [
      { target: "main form[aria-label=\"Find emails\"]", title: "Find emails", text: "Search by shop name or visit ID, or narrow the list by status and last attempt." },
      { target: "main table", title: "Emails to decide", text: "Each survey email that needs a decision. Check the email provider before sending again." },
      { target: "main form[aria-label=\"Page size\"]", title: "Rows per page", text: "Choose how many emails to show at once." },
      { target: "main nav[aria-label=\"Email review pages\"]", title: "More pages", text: "Move through the rest of the emails here." },
      { target: "main aside[aria-label=\"Decision guidance\"]", title: "Decision guidance", text: "What each status means and the safe choice for each one." },
    ],
  },
  {
    id: "bridge",
    path: /^\/psg\/bridge$/,
    steps: [
      { target: "[data-tour=\"tiles\"]", title: "At a glance", text: "Records waiting to go to FileMaker, retrying, failed, and when the last write was confirmed." },
      { target: "[aria-labelledby=\"bridge-state\"]", title: "Writes to FileMaker", text: "Whether Hub is copying records to FileMaker right now, and why." },
      { target: "[aria-labelledby=\"bridge-gates\"]", title: "Checks before writing", text: "Each check must be confirmed, with who confirmed it, before writes switch on." },
      { target: "[aria-labelledby=\"bridge-counts\"]", title: "Records by state", text: "How many records are waiting, retrying, confirmed or failed." },
      { target: "[aria-labelledby=\"bridge-retirement\"]", title: "Retirement", text: "The FileMaker reports and screens that still rely on the bridge. Sign off once none are left." },
      { target: "[aria-labelledby=\"bridge-problems\"]", title: "Needs attention", text: "Records that failed or conflict. Review each one and decide what to do." },
    ],
  },
  {
    id: "test-recipients",
    path: /^\/psg\/test-recipients$/,
    steps: [
      { target: "main table", title: "Test recipients", text: "Addresses and domains that may receive email from test shops. Remove any that no longer need it." },
      { target: "main nav[aria-label=\"Test recipient pages\"]", title: "More pages", text: "Move through the rest of the list here." },
      { target: "[aria-labelledby=\"add-entry\"]", title: "Add a recipient", text: "Add an email address or a whole domain so test emails can reach it." },
    ],
  },

  // Shop workspace
  {
    id: "shop-case",
    path: /^\/shop\/[^/]+\/cases\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Feedback to follow up", text: "A customer's negative feedback that PSG asked you to follow up. The link below opens their answers." },
      { target: "[aria-labelledby=\"attention\"]", title: "What needs attention", text: "The parts of the survey where the customer was unhappy." },
      { target: "[aria-labelledby=\"notes\"]", title: "Notes", text: "Record what you did for the customer, then ask PSG to close the case." },
    ],
  },
  {
    id: "shop-cases",
    path: /^\/shop\/[^/]+\/cases$/,
    steps: [
      { target: "main h1", title: "Follow-up", text: "Customer feedback PSG has asked you to follow up." },
      { target: "main table", title: "Cases", text: "Each case with what needs attention and its status. Open one to add notes." },
      { target: "main nav[aria-label=\"Follow-up pages\"]", title: "More pages", text: "Move through the rest of the cases here." },
    ],
  },
  {
    id: "shop-response",
    path: /^\/shop\/[^/]+\/responses\/[^/]+$/,
    steps: [
      { target: "main h1", title: "Customer response", text: "One customer's survey, with when it arrived and the repair visit it belongs to." },
      { target: "main section[aria-label=\"Scores\"]", title: "Scores", text: "The scores from this survey and any negative feedback in it." },
      { target: "[aria-labelledby=\"answers\"]", title: "Answers", text: "Everything the customer told you, question by question." },
    ],
  },
  {
    id: "shop-dashboard",
    path: /^\/shop\/[^/]+$/,
    steps: [...TOP_BAR_STEPS, ...DASHBOARD_STEPS],
  },
];
