import { Ban, FileText, HelpCircle, Lightbulb, Mail, MailX, PauseCircle, RefreshCw, Search, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { Field } from "@/components/ui";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { emailProblemCounts, listEmailProblems } from "@/modules/email-ledger/ledger";
import { STOP_LABELS } from "@/modules/email-ledger/policy";
import type { ProblemState } from "@/modules/email-ledger/store";
import { REASON_LABELS } from "@/modules/imports/eligibility";
import { ResolveControls } from "./resolve-controls";

export const metadata: Metadata = { title: "Email review" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const SELECT = "h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";
const PAGE_SIZES = [10, 20, 50] as const;

const STATE_LABELS: Record<ProblemState, string> = {
  acceptance_unknown: "Outcome unknown",
  held: "On hold",
  failed: "Failed",
  bounced: "Bounced",
};
const STATE_TILES: Record<ProblemState, { icon: LucideIcon; tone: string; chip: string }> = {
  acceptance_unknown: { icon: HelpCircle, tone: "bg-blue-50 text-blue-600", chip: "bg-blue-50 text-blue-700" },
  held: { icon: PauseCircle, tone: "bg-slate-100 text-slate-600", chip: "bg-slate-100 text-slate-700" },
  failed: { icon: MailX, tone: "bg-amber-50 text-amber-600", chip: "bg-amber-50 text-amber-800" },
  bounced: { icon: Ban, tone: "bg-rose-50 text-rose-600", chip: "bg-rose-50 text-rose-700" },
};
const STATES = Object.keys(STATE_LABELS) as ProblemState[];

const KIND_LABELS: Record<string, string> = { initial: "Invitation", reminder: "Reminder", renewal: "New link", alert: "Alert to shop" };

const reasonLabel = (code: string | null) => (code ? (REASON_LABELS[code as keyof typeof REASON_LABELS] ?? STOP_LABELS[code] ?? code) : null);

/** Emails that need a person: nothing here is retried or released automatically (SR-23, SR-26). */
export default async function EmailReviewPage({ searchParams }: PageProps<"/psg/email">) {
  const current = await pageRequireCapability("operations.view");
  const canManage = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const filter = {
    state: STATES.includes(one(query.state) as ProblemState) ? (one(query.state) as ProblemState) : undefined,
    sinceDays: [7, 30, 90].find((n) => String(n) === one(query.since)),
    q: one(query.q).trim().slice(0, 100) || undefined,
  };
  const per = PAGE_SIZES.find((n) => String(n) === one(query.per)) ?? 10;
  const [list, counts] = await Promise.all([listEmailProblems(pageNumber(query.page), filter, per), emailProblemCounts()]);
  const problems = list.items;
  const searching = Boolean(filter.state || filter.sinceDays || filter.q);
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Link href="/psg" className="text-sm text-gray-500 hover:text-brand-navy-900">
            ← Back to Overview
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Email review</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Survey emails that need a decision. When the outcome is unknown, check the email provider first, because sending again could email the customer twice. Held emails wait here after a pause
            instead of all sending at once.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm lg:grid-cols-4">
          {STATES.map((st) => {
            const t = STATE_TILES[st];
            return (
              <div key={st} className="flex items-center gap-3">
                <span className={`rounded-full p-3 ${t.tone}`} aria-hidden="true">
                  <t.icon className="size-5" />
                </span>
                <div>
                  <p className="text-xl font-semibold tabular-nums text-brand-navy-900">{counts[st]}</p>
                  <p className="text-xs text-gray-600">{STATE_LABELS[st]}</p>
                </div>
              </div>
            );
          })}
        </div>

        <LiveForm label="Find emails" className="flex flex-wrap items-end gap-2">
          {Object.entries(base).map(([k, v]) => (["q", "state", "since"].includes(k) ? null : <input key={k} type="hidden" name={k} value={v} />))}
          <div className="relative min-w-48 flex-1">
            <label htmlFor="email-search" className="sr-only">
              Search emails
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
            <input
              id="email-search"
              name="q"
              type="search"
              defaultValue={filter.q ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Search by shop name or visit ID..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400"
            />
          </div>
          <Field id="email-state" label="Status">
            <select id="email-state" name="state" defaultValue={filter.state ?? ""} className={SELECT}>
              <option value="">All statuses</option>
              {STATES.map((st) => (
                <option key={st} value={st}>
                  {STATE_LABELS[st]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="email-since" label="Last attempt">
            <select id="email-since" name="since" defaultValue={filter.sinceDays ? String(filter.sinceDays) : ""} className={SELECT}>
              <option value="">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </Field>
          {searching && (
            <Link href="/psg/email" className="flex h-10 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
              Clear filters
            </Link>
          )}
          <noscript>
            <button type="submit" className="h-10 rounded-lg bg-brand-navy-900 px-3 text-sm text-white">
              Apply
            </button>
          </noscript>
        </LiveForm>

        <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Shop and visit</th>
                  <th scope="col" className="px-3 py-3 font-medium">Email</th>
                  <th scope="col" className="px-3 py-3 font-medium">Status</th>
                  <th scope="col" className="px-3 py-3 font-medium">Last attempt</th>
                  {canManage && <th scope="col" className="px-3 py-3 font-medium">Decision</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {problems.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="px-5 py-14 text-center">
                      <Mail aria-hidden="true" className="mx-auto mb-3 size-16 rounded-full bg-indigo-50 p-4 text-indigo-500" />
                      <p className="text-base font-semibold text-brand-navy-900">{searching ? "No emails match these filters." : "Nothing needs review."}</p>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">{searching ? "Try another status or date range." : "You're all caught up. When a survey email needs a decision, it appears here."}</p>
                    </td>
                  </tr>
                )}
                {problems.map((p) => {
                  const why = reasonLabel(p.stateReason) ?? p.lastError;
                  const state = p.state as ProblemState;
                  return (
                    <tr key={p.id} className="align-top hover:bg-gray-50/60">
                      <td className="px-5 py-3">
                        <span className="font-medium text-gray-900">{p.shopName}</span>
                        <span className="block font-mono text-xs text-gray-500">
                          {p.sourceVisitKey ?? "no visit"}
                          {p.isTest ? " · Test" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-800">{KIND_LABELS[p.kind] ?? p.kind}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATE_TILES[state]?.chip ?? "bg-gray-100 text-gray-700"}`}>{STATE_LABELS[state] ?? p.state}</span>
                        {why && <span className="mt-1 block max-w-72 text-xs text-gray-600">{why}</span>}
                        <span className="block text-xs text-gray-500">
                          {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · {p.events} provider event{p.events === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{p.lastAttemptAt ? dateTime.format(p.lastAttemptAt) : "Not attempted"}</td>
                      {canManage && (
                        <td className="px-3 py-3">
                          <ResolveControls intentId={p.id} state={p.state} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
            <LiveForm label="Page size" className="flex items-center gap-2">
              {Object.entries(base).map(([k, v]) => (k === "per" ? null : <input key={k} type="hidden" name={k} value={v} />))}
              <label htmlFor="email-per-page" className="text-xs text-gray-500">
                Show
              </label>
              <select id="email-per-page" name="per" defaultValue={per === 10 ? "" : String(per)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800">
                <option value="">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </LiveForm>
            <div className="min-w-0 flex-1">
              <Pagination {...list} path="/psg/email" query={base} label="Email review pages" />
            </div>
          </div>
        </div>
      </div>

      <aside aria-label="Decision guidance" className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="rounded-full bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
              <FileText className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-brand-navy-900">Decision guidance</h2>
              <p className="text-xs text-gray-500">Look at the latest attempt before deciding whether to send again.</p>
            </div>
          </div>
          <ol className="mt-4 flex flex-col divide-y divide-gray-100">
            {(
              [
                [Search, "1. Check the email provider", "When the outcome is unknown, check the provider first so the customer is never emailed twice."],
                [RefreshCw, "2. Choose a decision", "Confirm it was sent, or mark it not sent to queue it once more. Failed emails can be retried."],
                [PauseCircle, "3. Held emails", "Emails wait here after a pause instead of all sending at once. Release them when ready."],
              ] as [LucideIcon, string, string][]
            ).map(([Icon, title, text]) => (
              <li key={title} className="flex gap-3 py-3">
                <span className="h-fit rounded-full bg-gray-100 p-2 text-indigo-600" aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-brand-navy-900">{title}</span>
                  <span className="block text-xs text-gray-600">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-base font-semibold text-brand-navy-900">
            <Lightbulb aria-hidden="true" className="size-4 text-amber-500" />
            Tips
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-600">
            <li>Look for the bounce or delivery status in your email provider.</li>
            <li>Use the filters to find one shop, status or date range.</li>
            <li>Only send again when you are sure the customer did not get the email.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
