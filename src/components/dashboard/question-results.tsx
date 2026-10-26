import { ListFilter, MessageSquareText } from "lucide-react";
import Link from "next/link";
import type { Bar, QuestionResult } from "@/modules/dashboard/answers";
import { pct, score } from "./format";

const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm";
const round = (v: number | null) => score(v, "None yet");

/**
 * How customers answered each question, for the counted responses of the
 * version the scores show. Every bar opens the dashboard filtered to the
 * customers who gave that answer, so PSG and the shop can see who they are
 * and how they answered everything else.
 */
export function QuestionResults({
  questions,
  versionLabel,
  answerLabel,
  filterHref,
  clearHref,
  responseHref,
}: {
  questions: QuestionResult[];
  versionLabel: string;
  answerLabel: string | null;
  /** The dashboard filtered to one answer. */
  filterHref: (answer: string) => string;
  clearHref: string;
  responseHref: (id: string) => string;
}) {
  return (
    <section data-tour="questions" aria-labelledby="questions-heading" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="questions-heading" className="scroll-mt-20 text-base font-semibold text-brand-navy-900">
            Question results
          </h2>
          <p className="text-xs text-gray-500">How customers answered each question · surveys counted in scores · {versionLabel}. Click an answer to show only the responses with it.</p>
        </div>
      </div>
      {answerLabel && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
          <ListFilter aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">Showing only customers who answered {answerLabel}</span>
          <Link href={clearHref} className="font-medium text-indigo-700 hover:underline">
            Show all answers
          </Link>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {questions.map((q, i) => (
          <article key={q.id} aria-labelledby={`q-${q.id}`} className={`${card} min-w-0 ${q.kind === "matrix" ? "lg:col-span-2" : ""}`}>
            <h3 id={`q-${q.id}`} className="text-sm font-semibold text-brand-navy-900">
              <span className="mr-1.5 text-gray-500">{i + 1}.</span>
              {q.title}
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {q.answered} answered
              {q.kind === "bars" && q.average !== null && ` · average ${round(q.average)}`}
              {q.kind === "bars" && q.multi && " · customers could pick more than one"}
            </p>
            <div className="mt-3">
              {q.answered === 0 ? (
                <p className="text-sm text-gray-500">Nobody has answered this question in this view.</p>
              ) : q.kind === "bars" ? (
                <ul className="flex flex-col gap-1.5">
                  {q.bars.map((b) => (
                    <li key={b.filter}>
                      <BarRow bar={b} of={q.answered} question={q.title} href={filterHref(b.filter)} />
                    </li>
                  ))}
                </ul>
              ) : q.kind === "matrix" ? (
                <Matrix result={q} filterHref={filterHref} />
              ) : q.kind === "number" ? (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Average", q.average],
                      ["Lowest", q.min],
                      ["Highest", q.max],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-lg bg-gray-50 px-2 py-2">
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="text-lg font-semibold tabular-nums text-brand-navy-900">{round(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <ul className="flex flex-col gap-2">
                  {q.latest.map((t) => (
                    <li key={t.responseId} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gray-400" />
                      <p className="line-clamp-3 min-w-0 flex-1 break-words text-gray-800">{t.text}</p>
                      <Link href={responseHref(t.responseId)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline">
                        View<span className="sr-only"> this response</span>
                      </Link>
                    </li>
                  ))}
                  {q.answered > q.latest.length && <li className="text-xs text-gray-500">Newest {q.latest.length} of {q.answered}. The rest are in each response and in Export CSV.</li>}
                </ul>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BarRow({ bar, of, question, href }: { bar: Bar; of: number; question: string; href: string }) {
  const share = pct(bar.count, of);
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-gray-700">{bar.label}</span>
        <span className="shrink-0 tabular-nums text-gray-900">
          <span className="font-semibold">{bar.count}</span> <span className="text-xs text-gray-500">({share}%)</span>
        </span>
      </span>
      <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${share}%`, background: "var(--color-chart-total)" }} />
      </span>
    </>
  );
  // Nothing to show for an answer nobody gave.
  if (bar.count === 0) return <div className="px-2 py-1">{body}</div>;
  return (
    <Link href={href} aria-label={`${question}: ${bar.label}, ${bar.count} (${share}%). Show these customers`} className="block rounded-lg px-2 py-1 transition hover:bg-indigo-50/60">
      {body}
    </Link>
  );
}

function Matrix({ result, filterHref }: { result: Extract<QuestionResult, { kind: "matrix" }>; filterHref: (answer: string) => string }) {
  return (
    <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              <span className="sr-only">Row</span>
            </th>
            {result.columns.map((c) => (
              <th key={c.id} scope="col" className="px-2 py-1.5 text-center font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {result.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="py-1.5 pr-3 font-normal text-gray-800">
                {r.label}
              </th>
              {r.cells.map((c) => {
                const share = pct(c.count, r.answered);
                return (
                  <td key={c.filter} className="px-1 py-1 text-center tabular-nums">
                    {c.count === 0 ? (
                      <span className="block rounded-md px-2 py-1 text-gray-500">0</span>
                    ) : (
                      <Link
                        href={filterHref(c.filter)}
                        aria-label={`${r.label}: ${c.label}, ${c.count} (${share}%). Show these customers`}
                        className="block rounded-md px-2 py-1 text-gray-900 hover:ring-1 hover:ring-indigo-300"
                        style={{ background: `color-mix(in srgb, var(--color-chart-total) ${Math.round(6 + share * 0.2)}%, transparent)` }}
                      >
                        {c.count} <span className="text-xs text-gray-700">({share}%)</span>
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
