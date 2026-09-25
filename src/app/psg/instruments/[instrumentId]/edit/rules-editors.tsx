"use client";

import { Plus, Trash2 } from "lucide-react";
import { isNumericCapable, uniqueId } from "@/modules/instruments/builder-ops";
import type { AlertRule, InstrumentDefinition, Metric, Question, SuppressionRule } from "@/modules/instruments/definition";
import { ConditionEditor } from "./condition-editor";
import { buttonClass, compactInputClass, NumberInput, optional, SelectInput, TextInput } from "./ui";

interface RulesProps {
  definition: InstrumentDefinition;
  questions: Question[];
  update: (fn: (d: InstrumentDefinition) => void) => void;
}

const METHOD_LABELS: Record<Metric["method"], string> = {
  mean: "Average of item values",
  sum: "Sum of item values",
  ratio_of_max: "Share of maximum possible (0 to 1)",
  share_matching: "Share of answers matching values (0 to 1)",
};

function Card({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-brand-navy-900">{title}</h3>
        <button type="button" onClick={onRemove} className={buttonClass.danger}>
          <Trash2 aria-hidden="true" className="size-4" /> Remove
        </button>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function IdAndLabel({ id, label, onId, onLabel, onSource, sourceRef }: { id: string; label: string; onId: (v: string) => void; onLabel: (v: string) => void; onSource: (v: string | undefined) => void; sourceRef?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextInput label="Name" value={label} onChange={onLabel} />
      <TextInput label="ID" value={id} mono onChange={(v) => onId(v.toLowerCase())} />
      <TextInput label="Source reference (optional)" value={sourceRef ?? ""} onChange={(v) => onSource(optional(v))} />
    </div>
  );
}

export function MetricsEditor({ definition, questions, update }: RulesProps) {
  const scorable = questions.filter((q) => q.type !== "text" && q.type !== "multi_choice");
  const set = (index: number, fn: (m: Metric) => void) => update((d) => fn(d.metrics[index]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        Metrics are calculated on the server from submitted answers and stored unrounded. A skipped answer is never counted as zero.
      </p>
      {definition.metrics.map((metric, index) => (
        <Card key={index} title={metric.label || metric.id} onRemove={() => update((d) => void d.metrics.splice(index, 1))}>
          <IdAndLabel
            id={metric.id}
            label={metric.label}
            sourceRef={metric.sourceRef}
            onId={(v) => set(index, (m) => void (m.id = v))}
            onLabel={(v) => set(index, (m) => void (m.label = v))}
            onSource={(v) => set(index, (m) => void (m.sourceRef = v))}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectInput<Metric["method"]>
              label="Formula"
              value={metric.method}
              options={(Object.keys(METHOD_LABELS) as Metric["method"][]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
              onChange={(method) =>
                set(index, (m) => {
                  m.method = method;
                  if (method === "share_matching") m.matchValues ??= [];
                  else delete m.matchValues;
                })
              }
            />
            <SelectInput<Metric["missing"]>
              label="Skipped items"
              value={metric.missing}
              options={[
                { value: "ignore", label: "Leave them out" },
                { value: "null_if_any_missing", label: "No score if any is skipped" },
              ]}
              onChange={(missing) => set(index, (m) => void (m.missing = missing))}
            />
            <NumberInput label="Minimum answered items" integer min={1} value={metric.minAnswered} onChange={(v) => set(index, (m) => void (m.minAnswered = v ?? 1))} />
          </div>

          {metric.method === "share_matching" && (
            <TextInput
              label="Answers that count as a match"
              value={(metric.matchValues ?? []).join(", ")}
              mono
              onChange={(v) =>
                set(index, (m) => {
                  m.matchValues = v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s));
                })
              }
              hint="Option IDs or numbers, separated by commas. Example: yes"
            />
          )}

          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Scored items</legend>
            <ul className="mt-2 flex flex-col gap-2">
              {metric.items.map((item, i) => {
                const question = questions.find((q) => q.id === item.question);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <select
                      aria-label="Question"
                      value={item.question}
                      onChange={(e) =>
                        set(index, (m) => {
                          const q = questions.find((x) => x.id === e.target.value);
                          m.items[i] = { question: e.target.value, weight: m.items[i].weight, ...(q?.type === "matrix" ? { row: q.rows[0]?.id } : {}) };
                        })
                      }
                      className={`${compactInputClass} w-auto max-w-72 py-1`}
                    >
                      {!question && <option value={item.question}>{item.question} (missing)</option>}
                      {scorable.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.id}: {q.title.slice(0, 40)}
                          {metric.method !== "share_matching" && !isNumericCapable(q) ? " (no values)" : ""}
                        </option>
                      ))}
                    </select>
                    {question?.type === "matrix" && (
                      <select
                        aria-label="Row"
                        value={item.row ?? ""}
                        onChange={(e) => set(index, (m) => void (m.items[i].row = e.target.value))}
                        className={`${compactInputClass} w-auto py-1`}
                      >
                        {question.rows.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-1 text-sm text-gray-600">
                      Weight
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={item.weight}
                        onChange={(e) => set(index, (m) => void (m.items[i].weight = Number(e.target.value) || 1))}
                        className={`${compactInputClass} w-20 py-1`}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="Remove item"
                      disabled={metric.items.length <= 1}
                      onClick={() => set(index, (m) => void m.items.splice(i, 1))}
                      className={`${buttonClass.danger} ml-auto`}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {scorable.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  set(index, (m) => {
                    const q = scorable[0];
                    m.items.push({ question: q.id, weight: 1, ...(q.type === "matrix" ? { row: q.rows[0]?.id } : {}) });
                  })
                }
                className={`${buttonClass.ghost} mt-2`}
              >
                <Plus aria-hidden="true" className="size-4" /> Add item
              </button>
            )}
          </fieldset>
        </Card>
      ))}
      <AddButton
        label="Add metric"
        disabled={scorable.length === 0}
        disabledHint="Add a rating, number, choice or matrix question first."
        onClick={() =>
          update((d) => {
            const q = scorable[0];
            d.metrics.push({
              id: uniqueId("metric", d.metrics.map((m) => m.id)),
              label: "New metric",
              method: "mean",
              items: [{ question: q.id, weight: 1, ...(q.type === "matrix" ? { row: q.rows[0]?.id } : {}) }],
              missing: "ignore",
              minAnswered: 1,
            });
          })
        }
      />
    </div>
  );
}

export function AlertsEditor({ definition, questions, update }: RulesProps) {
  const metrics = definition.metrics.map((m) => ({ id: m.id, label: m.label }));
  const set = (index: number, fn: (a: AlertRule) => void) => update((d) => fn(d.alerts[index]));
  const ordered = definition.alerts.map((alert, index) => ({ alert, index })).sort((a, b) => a.alert.precedence - b.alert.precedence);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        A fired alert creates a PSG review item. Nothing is emailed to the shop until PSG approves it (SR-32). When several alerts fire, the lowest order number is the primary one.
      </p>
      {ordered.map(({ alert, index }) => (
        <Card key={index} title={alert.label || alert.id} onRemove={() => update((d) => void d.alerts.splice(index, 1))}>
          <IdAndLabel
            id={alert.id}
            label={alert.label}
            sourceRef={alert.sourceRef}
            onId={(v) => set(index, (a) => void (a.id = v))}
            onLabel={(v) => set(index, (a) => void (a.label = v))}
            onSource={(v) => set(index, (a) => void (a.sourceRef = v))}
          />
          <div className="max-w-48">
            <NumberInput label="Order (1 = highest)" integer min={0} value={alert.precedence} onChange={(v) => set(index, (a) => void (a.precedence = v ?? 0))} />
          </div>
          <RuleCondition when={alert.when} onChange={(c) => set(index, (a) => void (a.when = c))} questions={questions} metrics={metrics} />
        </Card>
      ))}
      <AddButton
        label="Add alert rule"
        disabled={questions.length === 0}
        disabledHint="Add a question first."
        onClick={() =>
          update((d) => {
            const q = questions[0];
            d.alerts.push({
              id: uniqueId("alert", d.alerts.map((a) => a.id)),
              label: "New alert",
              precedence: Math.max(0, ...d.alerts.map((a) => a.precedence)) + 1,
              when: { question: q.id, op: "answered" },
            });
          })
        }
      />
    </div>
  );
}

export function SuppressionsEditor({ definition, questions, update }: RulesProps) {
  const metrics = definition.metrics.map((m) => ({ id: m.id, label: m.label }));
  const set = (index: number, fn: (s: SuppressionRule) => void) => update((d) => fn(d.suppressions[index]));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        A fired rule adds a routine-mail suppression action to the manual FileMaker queue (SR-36). Creating the action is not the same as applying it.
      </p>
      {definition.suppressions.map((rule, index) => (
        <Card key={index} title={rule.label || rule.id} onRemove={() => update((d) => void d.suppressions.splice(index, 1))}>
          <IdAndLabel
            id={rule.id}
            label={rule.label}
            sourceRef={rule.sourceRef}
            onId={(v) => set(index, (s) => void (s.id = v))}
            onLabel={(v) => set(index, (s) => void (s.label = v))}
            onSource={(v) => set(index, (s) => void (s.sourceRef = v))}
          />
          <RuleCondition when={rule.when} onChange={(c) => set(index, (s) => void (s.when = c))} questions={questions} metrics={metrics} />
        </Card>
      ))}
      <AddButton
        label="Add suppression rule"
        disabled={questions.length === 0}
        disabledHint="Add a question first."
        onClick={() =>
          update((d) => {
            d.suppressions.push({ id: uniqueId("suppression", d.suppressions.map((s) => s.id)), label: "New suppression rule", when: { question: questions[0].id, op: "answered" } });
          })
        }
      />
    </div>
  );
}

/** A rule's condition cannot be empty; clearing every clause keeps the last one. */
function RuleCondition({
  when,
  onChange,
  questions,
  metrics,
}: {
  when: AlertRule["when"];
  onChange: (c: AlertRule["when"]) => void;
  questions: Question[];
  metrics: { id: string; label: string }[];
}) {
  return (
    <ConditionEditor
      label="Fires when"
      condition={when}
      onChange={(c) => c && onChange(c)}
      questions={questions}
      metrics={metrics}
      emptyText="A rule needs at least one clause."
    />
  );
}

function AddButton({ label, onClick, disabled, disabledHint }: { label: string; onClick: () => void; disabled: boolean; disabledHint: string }) {
  return (
    <div>
      <button type="button" onClick={onClick} disabled={disabled} className={buttonClass.secondary}>
        <Plus aria-hidden="true" className="size-4" /> {label}
      </button>
      {disabled && <p className="mt-1 text-xs text-gray-500">{disabledHint}</p>}
    </div>
  );
}

