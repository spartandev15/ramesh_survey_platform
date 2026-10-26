import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { parseDefinition, type Question } from "@/modules/instruments/definition";
import { describeCondition, QUESTION_TYPE_LABELS } from "@/modules/instruments/describe";
import { getInstrument } from "@/modules/instruments/instruments";
import { InstrumentNotFoundError } from "@/modules/instruments/store";
import { StatusBadge, TestBadge } from "../version-badges";
import { TestLinksSection } from "./test-links-section";
import { VersionActions } from "./version-actions";

export const metadata: Metadata = { title: "Survey" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

async function load(instrumentId: string) {
  try {
    return await getInstrument(instrumentId);
  } catch (error) {
    if (error instanceof InstrumentNotFoundError) return null;
    throw error;
  }
}

export default async function InstrumentPage({ params, searchParams }: PageProps<"/psg/instruments/[instrumentId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "instrument.manage");
  const { instrumentId } = await params;
  const query = await searchParams;
  const requested = query.version;
  const found = await load(instrumentId);
  if (!found) notFound();

  const { instrument, versions } = found;
  const selected = versions.find((v) => String(v.version) === requested) ?? versions.find((v) => v.status === "published") ?? versions[0];
  const parsed = selected ? parseDefinition(selected.definition) : null;

  return (
    <div className="max-w-5xl">
      <Link href="/psg/instruments" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Surveys
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900">{instrument.name}</h1>
      <p className="mt-1 font-mono text-xs text-gray-500">{instrument.key}</p>
      {instrument.description && <p className="mt-2 text-sm text-gray-600">{instrument.description}</p>}

      <nav aria-label="Versions" className="mt-6 flex flex-wrap gap-2">
        {versions.map((v) => (
          <Link
            key={v.id}
            href={`/psg/instruments/${instrument.id}?version=${v.version}`}
            aria-current={v.id === selected?.id ? "page" : undefined}
            className={
              v.id === selected?.id
                ? "rounded-lg bg-brand-navy-900 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700"
            }
          >
            v{v.version} · {v.status === "published" ? "Published" : "Draft"}
          </Link>
        ))}
      </nav>

      {selected && (
        <section aria-label="Version details" className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-brand-navy-900">Version {selected.version}</h2>
            <StatusBadge status={selected.status} />
            <TestBadge isTest={selected.isTest} />
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Published</dt>
              <dd className="text-gray-900">{selected.publishedAt ? dateTime.format(selected.publishedAt) : "Not yet"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Content hash (SHA-256)</dt>
              <dd className="break-all font-mono text-xs text-gray-900">{selected.definitionHash ?? "Set when published"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Source</dt>
              <dd className="text-gray-900">{selected.sourceNote ?? "Not recorded"}</dd>
            </div>
          </dl>
          {selected.isTest && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Test version. It can be used for internal testing only and never for Live customers.
            </p>
          )}
        </section>
      )}

      {canManage && selected && (
        <VersionActions
          instrumentId={instrument.id}
          instrumentName={instrument.name}
          selected={{ id: selected.id, version: selected.version, status: selected.status }}
          hasDraft={versions.some((v) => v.status === "draft")}
        />
      )}

      {parsed && !parsed.ok && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">This version could not be read: {parsed.issues[0]?.message}</p>
      )}

      {parsed?.ok && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-brand-navy-900">Questions</h2>
          {parsed.definition.intro && <p className="mt-1 text-sm text-gray-600">{parsed.definition.intro}</p>}
          <div className="mt-3 flex flex-col gap-4">
            {parsed.definition.pages.map((page, index) => (
              <section key={page.id} className="rounded-xl border border-gray-200 bg-white">
                <h3 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
                  Page {index + 1}
                  {page.title ? `: ${page.title}` : ""}
                </h3>
                <ol className="divide-y divide-gray-100">
                  {page.questions.map((q) => (
                    <QuestionRow key={q.id} question={q} />
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <h2 className="mt-8 text-lg font-semibold text-brand-navy-900">Scoring</h2>
          <RuleTable
            empty="No metrics defined."
            head={["Metric", "Method", "Items", "Missing answers"]}
            rows={parsed.definition.metrics.map((m) => [
              <MetricName key="n" id={m.id} label={m.label} />,
              m.method === "share_matching" ? `share_matching [${m.matchValues?.join(", ")}]` : m.method,
              m.items.map((i) => `${i.question}${i.row ? `.${i.row}` : ""}${i.weight !== 1 ? ` ×${i.weight}` : ""}`).join(", "),
              `${m.missing === "ignore" ? "Left out" : "Metric is empty if any is missing"}; needs ${m.minAnswered}`,
            ])}
          />

          <h2 className="mt-8 text-lg font-semibold text-brand-navy-900">Alert rules</h2>
          <RuleTable
            empty="No alert rules defined."
            head={["Order", "Alert", "Fires when"]}
            rows={[...parsed.definition.alerts]
              .sort((a, b) => a.precedence - b.precedence)
              .map((a) => [String(a.precedence), <MetricName key="n" id={a.id} label={a.label} />, describeCondition(a.when)])}
          />

          <h2 className="mt-8 text-lg font-semibold text-brand-navy-900">Routine-mail suppression rules</h2>
          <RuleTable
            empty="No suppression rules defined."
            head={["Rule", "Applies when"]}
            rows={parsed.definition.suppressions.map((s) => [<MetricName key="n" id={s.id} label={s.label} />, describeCondition(s.when)])}
          />
        </>
      )}

      {selected?.status === "published" && <TestLinksSection instrumentId={instrument.id} versionId={selected.id} canManage={canManage} ownerShopId={instrument.shopId} query={query} />}
    </div>
  );
}

function MetricName({ id, label }: { id: string; label: string }) {
  return (
    <>
      <span className="text-gray-900">{label}</span>
      <span className="block font-mono text-xs text-gray-500">{id}</span>
    </>
  );
}

function RuleTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div tabIndex={0} className="mt-3 overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-4 py-6 text-left text-gray-500 sm:text-center">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell, c) => (
                <td key={c} className="px-4 py-3 align-top text-gray-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionRow({ question: q }: { question: Question }) {
  const options =
    q.type === "single_choice" || q.type === "multi_choice" ? q.choices : q.type === "matrix" ? q.columns : null;
  // "Not scored" only matters when some options of the same question do score.
  const scored = options?.some((c) => c.value !== undefined) ?? false;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{q.id}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{QUESTION_TYPE_LABELS[q.type]}</span>
        {q.required === true && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">Required</span>}
        {typeof q.required === "object" && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">Required when {describeCondition(q.required)}</span>
        )}
      </div>
      <p className="mt-1 font-medium text-gray-900">{q.title}</p>
      {q.description && <p className="text-sm text-gray-600">{q.description}</p>}
      {q.visibleWhen && <p className="mt-1 text-sm text-brand-navy-700">Shown when {describeCondition(q.visibleWhen)}</p>}

      {q.type === "rating" && (
        <p className="mt-2 text-sm text-gray-600">
          Scale {q.min} to {q.max}
          {q.minLabel || q.maxLabel ? ` (${q.minLabel ?? q.min} → ${q.maxLabel ?? q.max})` : ""}
        </p>
      )}
      {q.type === "number" && (
        <p className="mt-2 text-sm text-gray-600">
          {q.integer ? "Whole number" : "Number"}
          {q.min !== undefined ? `, min ${q.min}` : ""}
          {q.max !== undefined ? `, max ${q.max}` : ""}
        </p>
      )}
      {q.type === "text" && <p className="mt-2 text-sm text-gray-600">Up to {q.maxLength} characters{q.multiline ? ", multiple lines" : ""}</p>}
      {q.type === "matrix" && (
        <p className="mt-2 text-sm text-gray-600">Rows: {q.rows.map((r) => `${r.label} (${r.id})`).join(", ")}</p>
      )}
      {options && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {options.map((c) => (
            <li key={c.id} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700">
              {c.label} <span className="font-mono text-gray-500">({c.id}{c.value !== undefined ? ` = ${c.value}` : scored ? ", not scored" : ""})</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
