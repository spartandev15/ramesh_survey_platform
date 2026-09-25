"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  changeOp,
  defaultClauseForMetric,
  defaultClauseForQuestion,
  fromEditable,
  METRIC_OPS,
  OP_LABELS,
  opsForQuestion,
  questionOptions,
  toEditable,
  type ConditionOp,
  type LeafCondition,
} from "@/modules/instruments/builder-ops";
import type { Condition, Question } from "@/modules/instruments/definition";
import { describeCondition } from "@/modules/instruments/describe";
import { buttonClass, compactInputClass } from "./ui";

interface ConditionEditorProps {
  label: string;
  condition: Condition | undefined;
  onChange: (condition: Condition | undefined) => void;
  /** Questions the condition may use (earlier questions for display rules). */
  questions: Question[];
  /** Metric ids, only for alert and suppression rules. */
  metrics?: { id: string; label: string }[];
  emptyText: string;
}

/**
 * Edits a condition as clauses joined by "all" or "any". Anything more nested
 * (possible via JSON) is shown read-only so it is never silently rewritten.
 */
export function ConditionEditor({ label, condition, onChange, questions, metrics = [], emptyText }: ConditionEditorProps) {
  const editable = toEditable(condition);

  if (!editable) {
    return (
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{condition ? describeCondition(condition) : ""}</p>
        <p className="mt-1 text-xs text-gray-500">This rule is nested. Edit it on the JSON tab, or clear it to rebuild here.</p>
        <button type="button" onClick={() => onChange(undefined)} className={`${buttonClass.danger} mt-1`}>
          Clear rule
        </button>
      </div>
    );
  }

  const byId = new Map(questions.map((q) => [q.id, q]));
  const canAdd = questions.length > 0 || metrics.length > 0;
  const update = (clauses: LeafCondition[], join = editable.join) => onChange(fromEditable({ join, clauses }));
  const firstClause = (): LeafCondition => (questions[0] ? defaultClauseForQuestion(questions[0]) : defaultClauseForMetric(metrics[0].id));

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700">{label}</legend>
      {editable.clauses.length === 0 && <p className="mt-1 text-sm text-gray-500">{emptyText}</p>}
      {editable.clauses.length > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
          <span>Match</span>
          <select
            aria-label="How clauses combine"
            value={editable.join}
            onChange={(e) => update(editable.clauses, e.target.value as "all" | "any")}
            className={`${compactInputClass} w-auto py-1`}
          >
            <option value="all">all of these</option>
            <option value="any">any of these</option>
          </select>
        </div>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {editable.clauses.map((clause, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
            <ClauseEditor
              clause={clause}
              questions={questions}
              metrics={metrics}
              question={"question" in clause ? byId.get(clause.question) : undefined}
              onChange={(next) => update(editable.clauses.map((c, i) => (i === index ? next : c)))}
            />
            <button
              type="button"
              aria-label="Remove clause"
              onClick={() => update(editable.clauses.filter((_, i) => i !== index))}
              className={`${buttonClass.danger} ml-auto`}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <button type="button" onClick={() => update([...editable.clauses, firstClause()])} className={`${buttonClass.ghost} mt-2`}>
          <Plus aria-hidden="true" className="size-4" /> Add clause
        </button>
      ) : (
        <p className="mt-1 text-xs text-gray-500">Add an earlier question first to build a rule.</p>
      )}
    </fieldset>
  );
}

function ClauseEditor({
  clause,
  questions,
  metrics,
  question,
  onChange,
}: {
  clause: LeafCondition;
  questions: Question[];
  metrics: { id: string; label: string }[];
  question: Question | undefined;
  onChange: (clause: LeafCondition) => void;
}) {
  const sourceValue = "metric" in clause ? `metric:${clause.metric}` : `question:${clause.question}`;
  const ops: ConditionOp[] = "metric" in clause ? METRIC_OPS : question ? opsForQuestion(question) : ["answered", "not_answered"];
  const select = `${compactInputClass} w-auto py-1`;

  function changeSource(value: string) {
    const [kind, id] = value.split(":");
    if (kind === "metric") return onChange(defaultClauseForMetric(id));
    const q = questions.find((x) => x.id === id);
    if (q) onChange(defaultClauseForQuestion(q));
  }

  return (
    <>
      <select aria-label="Rule source" value={sourceValue} onChange={(e) => changeSource(e.target.value)} className={`${select} max-w-56`}>
        {!questions.some((q) => sourceValue === `question:${q.id}`) && !metrics.some((m) => sourceValue === `metric:${m.id}`) && (
          <option value={sourceValue}>{sourceValue.split(":")[1]} (missing)</option>
        )}
        {questions.length > 0 && (
          <optgroup label="Questions">
            {questions.map((q) => (
              <option key={q.id} value={`question:${q.id}`}>
                {q.id}: {q.title.slice(0, 40)}
              </option>
            ))}
          </optgroup>
        )}
        {metrics.length > 0 && (
          <optgroup label="Metrics">
            {metrics.map((m) => (
              <option key={m.id} value={`metric:${m.id}`}>
                {m.id}: {m.label.slice(0, 40)}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {question?.type === "matrix" && "question" in clause && (
        <select
          aria-label="Matrix row"
          value={"row" in clause ? (clause.row ?? "") : ""}
          onChange={(e) => onChange({ ...clause, row: e.target.value } as LeafCondition)}
          className={select}
        >
          {question.rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      )}

      <select aria-label="Comparison" value={clause.op} onChange={(e) => onChange(changeOp(clause, e.target.value as ConditionOp, question))} className={select}>
        {!ops.includes(clause.op) && <option value={clause.op}>{OP_LABELS[clause.op]}</option>}
        {ops.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      <ClauseValue clause={clause} question={question} onChange={onChange} />
    </>
  );
}

function ClauseValue({ clause, question, onChange }: { clause: LeafCondition; question: Question | undefined; onChange: (clause: LeafCondition) => void }) {
  const select = `${compactInputClass} w-auto py-1`;
  const options = question ? questionOptions(question) : [];

  if ("values" in clause) {
    return (
      <div role="group" aria-label="Values" className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-1 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={clause.values.includes(o.id)}
              onChange={(e) => {
                const values = e.target.checked ? [...clause.values, o.id] : clause.values.filter((v) => v !== o.id);
                onChange({ ...clause, values } as LeafCondition);
              }}
              className="size-4 accent-brand-navy-900"
            />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  if (!("value" in clause)) return null;

  const numeric = typeof clause.value === "number";
  if (!numeric && options.length > 0) {
    return (
      <select aria-label="Value" value={String(clause.value)} onChange={(e) => onChange({ ...clause, value: e.target.value } as LeafCondition)} className={select}>
        {!options.some((o) => o.id === clause.value) && <option value={String(clause.value)}>{String(clause.value) || "(choose)"}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label="Value"
      type="number"
      step="any"
      value={Number.isNaN(clause.value as number) ? "" : clause.value}
      onChange={(e) => onChange({ ...clause, value: e.target.value === "" ? 0 : Number(e.target.value) } as LeafCondition)}
      className={`${compactInputClass} w-28 py-1`}
    />
  );
}
