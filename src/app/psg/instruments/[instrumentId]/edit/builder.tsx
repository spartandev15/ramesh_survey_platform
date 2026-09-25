"use client";

import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { insertQuestion, moveItem, moveQuestion, newQuestion, questionReferences, uniqueId, type QuestionPosition } from "@/modules/instruments/builder-ops";
import { allQuestions, parseDefinition, validateDefinition, type DefinitionIssue, type InstrumentDefinition, type QuestionType } from "@/modules/instruments/definition";
import { discardDraftAction, publishAction, saveDraftAction } from "../../actions";
import { SurveyCanvas, type Selection } from "./canvas";
import { Preview } from "./preview";
import { QuestionEditor } from "./question-editor";
import { AlertsEditor, MetricsEditor, SuppressionsEditor } from "./rules-editors";
import { buttonClass, inputClass, optional, TextInput } from "./ui";

export interface BuilderProps {
  instrumentId: string;
  instrumentName: string;
  versionId: string;
  versionNumber: number;
  basedOnVersion: number | null;
  initialRevision: number;
  initialSourceNote: string | null;
  initialDefinition: InstrumentDefinition;
  /** Question ids in the published version this draft is based on; they keep their ids. */
  lockedQuestionIds: string[];
  /** Option and row ids per locked question. */
  lockedOptionIds: Record<string, string[]>;
}

type Tab = "questions" | "scoring" | "alerts" | "suppressions" | "preview" | "json";
type SaveState = { state: "idle" | "saving" | "saved" | "error"; message?: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "questions", label: "Questions" },
  { id: "scoring", label: "Scoring" },
  { id: "alerts", label: "Alerts" },
  { id: "suppressions", label: "Suppression" },
  { id: "preview", label: "Preview" },
  { id: "json", label: "JSON" },
];

/** Where an issue points, from either "pages[0].questions[1]" or "pages.0.questions.1". */
function issueLocation(path: string): { page: number; question?: number } | null {
  const m = /^pages[.[](\d+)\]?(?:\.questions[.[](\d+))?/.exec(path);
  if (!m) return null;
  return { page: Number(m[1]), question: m[2] !== undefined ? Number(m[2]) : undefined };
}

function issueTab(path: string): Tab {
  if (path.startsWith("metrics")) return "scoring";
  if (path.startsWith("alerts")) return "alerts";
  if (path.startsWith("suppressions")) return "suppressions";
  return "questions";
}

export function Builder(props: BuilderProps) {
  const router = useRouter();
  const [definition, setDefinition] = useState(props.initialDefinition);
  const [revision, setRevision] = useState(props.initialRevision);
  const [sourceNote, setSourceNote] = useState(props.initialSourceNote ?? "");
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [serverIssues, setServerIssues] = useState<DefinitionIssue[]>([]);
  const [tab, setTab] = useState<Tab>("questions");
  const [selection, setSelection] = useState<Selection>({ kind: "survey" });
  const [publishOpen, setPublishOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = useCallback((fn: (d: InstrumentDefinition) => void) => {
    setDefinition((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setSave({ state: "idle" });
  }, []);

  const replaceDefinition = useCallback((next: InstrumentDefinition) => {
    setDefinition(next);
    setDirty(true);
    setSelection({ kind: "survey" });
  }, []);

  const issues = useMemo(() => {
    const parsed = parseDefinition(definition);
    return parsed.ok ? validateDefinition(parsed.definition) : parsed.issues;
  }, [definition]);
  const questions = useMemo(() => allQuestions(definition), [definition]);
  const lockedQuestions = useMemo(() => new Set(props.lockedQuestionIds), [props.lockedQuestionIds]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function saveNow(): Promise<number | null> {
    setSave({ state: "saving" });
    const result = await saveDraftAction({ versionId: props.versionId, expectedRevision: revision, definition, sourceNote: sourceNote.trim() || null });
    if (!result.ok) {
      setServerIssues(result.issues ?? []);
      setSave({ state: "error", message: result.message });
      return null;
    }
    setServerIssues([]);
    setRevision(result.revision);
    setDirty(false);
    setSave({ state: "saved", message: `Saved at ${new Date(result.savedAt).toLocaleTimeString()}` });
    return result.revision;
  }

  const handleSave = () => startTransition(async () => void (await saveNow()));

  // Ctrl/Cmd + S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !pending) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function publish(isTest: boolean) {
    startTransition(async () => {
      let current = revision;
      if (dirty) {
        const saved = await saveNow();
        if (saved === null) return;
        current = saved;
      }
      const result = await publishAction({ versionId: props.versionId, expectedRevision: current, isTest, sourceNote: sourceNote.trim() || null });
      if (!result.ok) {
        setServerIssues(result.issues ?? []);
        setSave({ state: "error", message: result.message });
        return;
      }
      setDirty(false);
      router.push(`/psg/instruments/${result.instrumentId}?version=${result.version}`);
    });
  }

  function discard() {
    if (!window.confirm(`Discard draft version ${props.versionNumber}? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await discardDraftAction({ versionId: props.versionId, expectedRevision: revision });
      if (!result.ok) return setSave({ state: "error", message: result.message });
      setDirty(false);
      router.push(`/psg/instruments/${result.instrumentId}`);
    });
  }

  const allIssues = serverIssues.length > 0 && !dirty ? serverIssues : issues;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/psg/instruments/${props.instrumentId}`} className="text-sm text-gray-500 hover:text-brand-navy-900">
            ← {props.instrumentName}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-brand-navy-900">
            Edit draft v{props.versionNumber}
            {props.basedOnVersion !== null && <span className="ml-2 text-sm font-normal text-gray-500">based on v{props.basedOnVersion}</span>}
          </h1>
          <p className="mt-1 text-sm text-gray-500" role="status" aria-live="polite">
            {save.state === "saving" ? "Saving…" : save.state === "error" ? "" : dirty ? "Unsaved changes" : (save.message ?? "All changes saved")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={discard} disabled={pending} className={buttonClass.danger}>
            <Trash2 aria-hidden="true" className="size-4" /> Discard draft
          </button>
          <button type="button" onClick={handleSave} disabled={pending || !dirty} className={buttonClass.secondary}>
            Save draft
          </button>
          <button type="button" onClick={() => setPublishOpen((o) => !o)} disabled={pending} aria-expanded={publishOpen} className={buttonClass.primary}>
            Publish…
          </button>
        </div>
      </header>

      {save.state === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {save.message}
        </p>
      )}

      {publishOpen && (
        <PublishPanel
          issueCount={allIssues.length}
          sourceNote={sourceNote}
          onSourceNote={(v) => {
            setSourceNote(v);
            setDirty(true);
          }}
          pending={pending}
          onPublish={publish}
          onCancel={() => setPublishOpen(false)}
        />
      )}

      <IssuesPanel
        issues={allIssues}
        onGo={(issue) => {
          const tabFor = issueTab(issue.path);
          setTab(tabFor);
          const loc = issueLocation(issue.path);
          if (tabFor === "questions" && loc) setSelection(loc.question !== undefined ? { kind: "question", page: loc.page, question: loc.question } : { kind: "page", page: loc.page });
        }}
      />

      <div role="tablist" aria-label="Builder sections" className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === t.id ? "border-brand-red text-brand-navy-900" : "border-transparent text-gray-500 hover:text-brand-navy-900"}`}
          >
            {t.label}
            {t.id === "alerts" && definition.alerts.length > 0 && <span className="ml-1 text-xs text-gray-400">({definition.alerts.length})</span>}
            {t.id === "scoring" && definition.metrics.length > 0 && <span className="ml-1 text-xs text-gray-400">({definition.metrics.length})</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "questions" && (
          <QuestionsTab
            definition={definition}
            update={update}
            selection={selection}
            setSelection={setSelection}
            issues={allIssues}
            lockedQuestions={lockedQuestions}
            lockedOptionIds={props.lockedOptionIds}
          />
        )}
        {tab === "scoring" && <MetricsEditor definition={definition} questions={questions} update={update} />}
        {tab === "alerts" && <AlertsEditor definition={definition} questions={questions} update={update} />}
        {tab === "suppressions" && <SuppressionsEditor definition={definition} questions={questions} update={update} />}
        {tab === "preview" && <Preview definition={definition} />}
        {tab === "json" && <JsonTab definition={definition} onApply={replaceDefinition} />}
      </div>
    </div>
  );
}

function PublishPanel({
  issueCount,
  sourceNote,
  onSourceNote,
  pending,
  onPublish,
  onCancel,
}: {
  issueCount: number;
  sourceNote: string;
  onSourceNote: (v: string) => void;
  pending: boolean;
  onPublish: (isTest: boolean) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"test" | "verified">("test");
  const blocked = issueCount > 0 || (kind === "verified" && sourceNote.trim() === "");

  return (
    <section aria-labelledby="publish-heading" className="rounded-xl border-2 border-brand-navy-900/20 bg-white p-5">
      <h2 id="publish-heading" className="text-lg font-semibold text-brand-navy-900">
        Publish this version
      </h2>
      <p className="mt-1 text-sm text-gray-600">A published version can never be changed or deleted. Later edits create a new version, and existing invitations keep the version they were issued with.</p>
      <fieldset className="mt-4 flex flex-col gap-2">
        <legend className="sr-only">Version type</legend>
        <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 has-[:checked]:border-brand-navy-900">
          <input type="radio" name="kind" checked={kind === "test"} onChange={() => setKind("test")} className="mt-1 size-4 accent-brand-navy-900" />
          <span>
            <span className="font-medium text-gray-900">Test version</span>
            <span className="block text-sm text-gray-600">For internal testing only. It can never be used for Live customers.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 has-[:checked]:border-brand-navy-900">
          <input type="radio" name="kind" checked={kind === "verified"} onChange={() => setKind("verified")} className="mt-1 size-4 accent-brand-navy-900" />
          <span>
            <span className="font-medium text-gray-900">Verified source version</span>
            <span className="block text-sm text-gray-600">
              Only when PSG has approved these exact questions, formulas and alert rules against the source. Record where they came from below.
            </span>
          </span>
        </label>
      </fieldset>
      <div className="mt-4">
        <TextInput
          label={kind === "verified" ? "Approved source (required)" : "Source note (optional)"}
          value={sourceNote}
          onChange={onSourceNote}
          multiline
          placeholder="e.g. Approved question catalog v3, signed off by … on …, export checksum …"
        />
      </div>
      {issueCount > 0 && (
        <p className="mt-3 text-sm text-red-800">
          Fix the {issueCount} problem{issueCount === 1 ? "" : "s"} listed above before publishing.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={blocked || pending} onClick={() => onPublish(kind === "test")} className={buttonClass.primary}>
          {pending ? "Publishing…" : kind === "test" ? "Publish test version" : "Publish verified version"}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass.secondary}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function IssuesPanel({ issues, onGo }: { issues: DefinitionIssue[]; onGo: (issue: DefinitionIssue) => void }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <CheckCircle2 aria-hidden="true" className="size-4" /> No problems found. This draft can be published.
      </p>
    );
  }
  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" open={issues.length <= 5}>
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <AlertTriangle aria-hidden="true" className="size-4" />
        {issues.length} problem{issues.length === 1 ? "" : "s"} to fix before publishing
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {issues.slice(0, 50).map((issue, i) => (
          <li key={i}>
            <button type="button" onClick={() => onGo(issue)} className="text-left hover:underline">
              {issue.message} <span className="font-mono text-xs text-amber-700">({issue.path})</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function QuestionsTab({
  definition,
  update,
  selection,
  setSelection,
  issues,
  lockedQuestions,
  lockedOptionIds,
}: {
  definition: InstrumentDefinition;
  update: (fn: (d: InstrumentDefinition) => void) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  issues: DefinitionIssue[];
  lockedQuestions: Set<string>;
  lockedOptionIds: Record<string, string[]>;
}) {
  const flagged = new Set(
    issues
      .map((i) => issueLocation(i.path))
      .filter((l): l is { page: number; question: number } => l?.question !== undefined)
      .map((l) => `${l.page}:${l.question}`),
  );

  const selectedQuestion = selection.kind === "question" ? definition.pages[selection.page]?.questions[selection.question] : undefined;
  const earlier =
    selection.kind === "question"
      ? definition.pages.slice(0, selection.page + 1).flatMap((p, pi) => (pi < selection.page ? p.questions : p.questions.slice(0, selection.question)))
      : [];

  function insert(type: QuestionType, at: QuestionPosition) {
    // Never reuse an ID from the published version, even if that question was deleted from this draft:
    // reports compare versions by question ID, so a reused ID would join two different questions (SR-15).
    const question = newQuestion(type, [...allQuestions(definition).map((q) => q.id), ...lockedQuestions]);
    // Mirror the insert on the current definition to know where it lands.
    const landed = insertQuestion(structuredClone(definition), question, at);
    update((d) => void insertQuestion(d, question, at));
    setSelection({ kind: "question", page: landed.page, question: landed.index });
  }

  function move(from: QuestionPosition, to: QuestionPosition) {
    const landed = moveQuestion(structuredClone(definition), from, to);
    update((d) => void moveQuestion(d, from, to));
    setSelection({ kind: "question", page: landed.page, question: landed.index });
  }

  function removeQuestion(pageIndex: number, questionIndex: number) {
    const q = definition.pages[pageIndex].questions[questionIndex];
    const refs = questionReferences(definition, q.id);
    const warning = refs.length > 0 ? `\n\nThese still refer to it and will need fixing: ${refs.join(", ")}.` : "";
    const locked = lockedQuestions.has(q.id) ? "\n\nIt is part of the published version, so removing it changes what later versions measure." : "";
    if (!window.confirm(`Remove question "${q.id}"?${warning}${locked}`)) return;
    update((d) => void d.pages[pageIndex].questions.splice(questionIndex, 1));
    setSelection({ kind: "page", page: pageIndex });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="h-fit lg:sticky lg:top-20">
        <SurveyCanvas
          definition={definition}
          selection={selection}
          onSelect={setSelection}
          flagged={flagged}
          onMove={move}
          onInsert={insert}
          onRemove={removeQuestion}
          onAddPage={() => {
            update((d) => void d.pages.push({ id: uniqueId("page", d.pages.map((x) => x.id)), questions: [] }));
            setSelection({ kind: "page", page: definition.pages.length });
          }}
          onMovePage={(from, to) => {
            update((d) => void (d.pages = moveItem(d.pages, from, to)));
            setSelection({ kind: "page", page: to });
          }}
          onRemovePage={(p) => {
            update((d) => void d.pages.splice(p, 1));
            setSelection({ kind: "survey" });
          }}
        />
      </div>

      <section aria-label="Editor" className="rounded-xl border border-gray-200 bg-white p-5">
        {selection.kind === "survey" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-brand-navy-900">Survey settings</h2>
            <TextInput label="Intro shown to respondents (optional)" value={definition.intro ?? ""} multiline onChange={(v) => update((d) => void (d.intro = optional(v)))} />
            <p className="text-sm text-gray-500">
              {allQuestions(definition).length} questions on {definition.pages.length} page{definition.pages.length === 1 ? "" : "s"}. Choose a question in the outline to edit it.
            </p>
          </div>
        )}

        {selection.kind === "page" && definition.pages[selection.page] && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-brand-navy-900">Page {selection.page + 1}</h2>
            <TextInput label="Page title (optional)" value={definition.pages[selection.page].title ?? ""} onChange={(v) => update((d) => void (d.pages[selection.page].title = optional(v)))} />
            <TextInput label="Page ID" value={definition.pages[selection.page].id} mono onChange={(v) => update((d) => void (d.pages[selection.page].id = v.toLowerCase()))} />
          </div>
        )}

        {selection.kind === "question" && selectedQuestion && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-brand-navy-900">
              Question <span className="font-mono text-sm text-gray-500">{selectedQuestion.id}</span>
            </h2>
            <QuestionEditor
              key={`${selection.page}-${selection.question}`}
              question={selectedQuestion}
              earlierQuestions={earlier}
              idLocked={lockedQuestions.has(selectedQuestion.id)}
              lockedOptionIds={lockedOptionIds[selectedQuestion.id] ?? []}
              onChange={(q) => update((d) => void (d.pages[selection.page].questions[selection.question] = q))}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function JsonTab({ definition, onApply }: { definition: InstrumentDefinition; onApply: (d: InstrumentDefinition) => void }) {
  const [text, setText] = useState(() => JSON.stringify(definition, null, 2));
  const [problems, setProblems] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  function apply() {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      setProblems([`Not valid JSON: ${(error as Error).message}`]);
      return;
    }
    const parsed = parseDefinition(raw);
    if (!parsed.ok) {
      setProblems(parsed.issues.map((i) => `${i.path}: ${i.message}`));
      return;
    }
    setProblems([]);
    setApplied(true);
    onApply(parsed.definition);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">
        The full definition as data. Useful for entering an approved question catalog in one go. Applying replaces the draft in the editor; save afterwards to keep it.
      </p>
      <label htmlFor="definition-json" className="sr-only">
        Definition JSON
      </label>
      <textarea
        id="definition-json"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setApplied(false);
        }}
        className={`${inputClass} h-[60vh] font-mono text-xs`}
      />
      {problems.length > 0 && (
        <ul role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {problems.slice(0, 20).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {applied && <p className="text-sm text-emerald-800">Applied to the draft. Save to keep it.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={apply} className={buttonClass.primary}>
          Apply JSON
        </button>
        <button type="button" onClick={() => setText(JSON.stringify(definition, null, 2))} className={buttonClass.secondary}>
          Reset to current draft
        </button>
      </div>
    </div>
  );
}
