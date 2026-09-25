"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ArrowDown, ArrowUp, CircleDot, FileText, Grid3x3, GripVertical, Hash, ListChecks, Plus, Star, Trash2, Type, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { QuestionPosition } from "@/modules/instruments/builder-ops";
import type { InstrumentDefinition, Question, QuestionType } from "@/modules/instruments/definition";
import { QUESTION_TYPE_LABELS } from "@/modules/instruments/describe";
import { buttonClass } from "./ui";

export type Selection = { kind: "survey" } | { kind: "page"; page: number } | { kind: "question"; page: number; question: number };

const TYPE_ICONS: Record<QuestionType, LucideIcon> = {
  single_choice: CircleDot,
  multi_choice: ListChecks,
  rating: Star,
  number: Hash,
  text: Type,
  matrix: Grid3x3,
};

const TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[];

// Drag ids. Positions are stable during a drag because the definition only changes on drop.
const questionKey = (page: number, index: number) => `q:${page}:${index}`;
const pageKey = (page: number) => `page:${page}`;
const paletteKey = (type: QuestionType) => `new:${type}`;

type DragTarget = { kind: "question"; page: number; index: number } | { kind: "page"; page: number } | { kind: "palette"; type: QuestionType };

function parseKey(key: string | number | undefined): DragTarget | null {
  if (typeof key !== "string") return null;
  const [kind, a, b] = key.split(":");
  if (kind === "q") return { kind: "question", page: Number(a), index: Number(b) };
  if (kind === "page") return { kind: "page", page: Number(a) };
  if (kind === "new") return { kind: "palette", type: a as QuestionType };
  return null;
}

interface CanvasProps {
  definition: InstrumentDefinition;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  flagged: Set<string>;
  onMove: (from: QuestionPosition, to: QuestionPosition) => void;
  onInsert: (type: QuestionType, at: QuestionPosition) => void;
  onRemove: (page: number, index: number) => void;
  onAddPage: () => void;
  onMovePage: (from: number, to: number) => void;
  onRemovePage: (page: number) => void;
}

/**
 * Survey canvas with an Alchemer-style palette: drag a question type onto a
 * page to add it, drag questions to reorder them within or across pages.
 * Every drag also works from the keyboard (focus a handle, Space, arrows, Space).
 */
export function SurveyCanvas(props: CanvasProps) {
  const { definition } = props;
  const [active, setActive] = useState<DragTarget | null>(null);
  const [over, setOver] = useState<DragTarget | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const label = (target: DragTarget | null) => {
    if (!target) return "";
    if (target.kind === "palette") return `new ${QUESTION_TYPE_LABELS[target.type].toLowerCase()} question`;
    if (target.kind === "page") return `end of page ${target.page + 1}`;
    const q = definition.pages[target.page]?.questions[target.index];
    return q ? `question ${q.id} on page ${target.page + 1}` : "question";
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${label(parseKey(a.id))}.`,
    onDragOver: ({ over: o }) => (o ? `Will be placed before ${label(parseKey(o.id))}.` : "Not over a drop position."),
    onDragEnd: ({ over: o }) => (o ? `Dropped before ${label(parseKey(o.id))}.` : "Dropped nowhere; nothing changed."),
    onDragCancel: () => "Drag cancelled; nothing changed.",
  };

  function handleStart(event: DragStartEvent) {
    setActive(parseKey(event.active.id));
  }

  function handleOver(event: DragOverEvent) {
    setOver(parseKey(event.over?.id));
  }

  function handleEnd(event: DragEndEvent) {
    const from = parseKey(event.active.id);
    const to = parseKey(event.over?.id);
    setActive(null);
    setOver(null);
    if (!from || !to || to.kind === "palette") return;

    const target: QuestionPosition =
      to.kind === "question" ? { page: to.page, index: to.index } : { page: to.page, index: definition.pages[to.page]?.questions.length ?? 0 };

    if (from.kind === "palette") {
      props.onInsert(from.type, target);
      return;
    }
    if (from.kind !== "question") return;
    if (from.page === target.page && from.index === target.index) return;
    // Dropping at the end of the same page: the item leaves first, so the last slot is length - 1.
    if (to.kind === "page" && from.page === to.page) target.index -= 1;
    props.onMove({ page: from.page, index: from.index }, target);
  }

  const activeQuestion = active?.kind === "question" ? definition.pages[active.page]?.questions[active.index] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragStart={handleStart}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActive(null);
        setOver(null);
      }}
    >
      <div className="flex flex-col gap-3">
        <section aria-label="Question types" className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Drag a question type onto a page</p>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((type) => (
              <PaletteItem
                key={type}
                type={type}
                onAdd={() => {
                  const page = props.selection.kind === "survey" ? definition.pages.length - 1 : props.selection.page;
                  const index = props.selection.kind === "question" ? props.selection.question + 1 : (definition.pages[page]?.questions.length ?? 0);
                  props.onInsert(type, { page, index });
                }}
              />
            ))}
          </div>
        </section>

        <nav aria-label="Survey outline" className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3">
          <button
            type="button"
            onClick={() => props.onSelect({ kind: "survey" })}
            aria-current={props.selection.kind === "survey" ? "true" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${props.selection.kind === "survey" ? "bg-brand-navy-900/10 font-medium text-brand-navy-900" : "text-gray-700 hover:bg-gray-50"}`}
          >
            <FileText aria-hidden="true" className="size-4" /> Survey settings
          </button>

          {definition.pages.map((page, p) => (
            <PageBlock key={p} pageIndex={p} title={page.title} count={definition.pages.length} {...props} over={over} dragging={active !== null}>
              <SortableContext items={page.questions.map((_, i) => questionKey(p, i))} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col">
                  {page.questions.map((q, i) => (
                    <QuestionCard
                      key={questionKey(p, i)}
                      id={questionKey(p, i)}
                      question={q}
                      active={props.selection.kind === "question" && props.selection.page === p && props.selection.question === i}
                      flagged={props.flagged.has(`${p}:${i}`)}
                      // Within one page the sortable animation already shows the landing spot; the line is for new or cross-page drops.
                      dropBefore={active !== null && over?.kind === "question" && over.page === p && over.index === i && !(active.kind === "question" && active.page === p)}
                      onSelect={() => props.onSelect({ kind: "question", page: p, question: i })}
                      onRemove={() => props.onRemove(p, i)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </PageBlock>
          ))}

          <button type="button" onClick={props.onAddPage} className={buttonClass.secondary}>
            <Plus aria-hidden="true" className="size-4" /> Add page
          </button>
        </nav>
      </div>

      <DragOverlay dropAnimation={null}>
        {active?.kind === "palette" && <PaletteChip type={active.type} lifted />}
        {activeQuestion && (
          <div className="rounded-lg border border-brand-navy-700 bg-white px-3 py-2 shadow-lg">
            <span className="font-mono text-[11px] text-gray-500">{activeQuestion.id}</span>
            <span className="block max-w-64 truncate text-sm font-medium text-brand-navy-900">{activeQuestion.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function PaletteChip({ type, lifted }: { type: QuestionType; lifted?: boolean }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${lifted ? "border-brand-navy-700 bg-white text-brand-navy-900 shadow-lg" : "border-gray-200 bg-gray-50 text-gray-700"}`}
    >
      <Icon aria-hidden="true" className="size-4 text-brand-red" />
      {QUESTION_TYPE_LABELS[type]}
    </span>
  );
}

function PaletteItem({ type, onAdd }: { type: QuestionType; onAdd: () => void }) {
  // No keyboard-drag attributes: the palette is a plain button for keyboard users (see onClick).
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: paletteKey(type) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      // Pointer drags only: Enter/Space on the palette simply adds the question
      // after the current selection, which is the simplest keyboard path.
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={onAdd}
      aria-label={`Add ${QUESTION_TYPE_LABELS[type].toLowerCase()} question. Drag onto a page to choose its position.`}
      className={`cursor-grab text-left transition hover:[&>span]:border-brand-navy-700 active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <PaletteChip type={type} />
    </button>
  );
}

function PageBlock({
  pageIndex: p,
  title,
  count,
  selection,
  onSelect,
  onMovePage,
  onRemovePage,
  definition,
  over,
  dragging,
  children,
}: CanvasProps & { pageIndex: number; title?: string; count: number; over: DragTarget | null; dragging: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: pageKey(p) });
  const isEmpty = definition.pages[p].questions.length === 0;
  const selected = selection.kind === "page" && selection.page === p;
  const overEnd = dragging && over?.kind === "page" && over.page === p;

  return (
    <div className="rounded-lg border border-gray-100">
      <div className="flex items-center gap-1 bg-gray-50 px-2 py-1">
        <button
          type="button"
          onClick={() => onSelect({ kind: "page", page: p })}
          aria-current={selected ? "true" : undefined}
          className={`flex-1 truncate text-left text-xs font-semibold uppercase tracking-wide ${selected ? "text-brand-red" : "text-gray-600"}`}
        >
          Page {p + 1}
          {title ? `: ${title}` : ""}
        </button>
        <button type="button" aria-label={`Move page ${p + 1} up`} disabled={p === 0} onClick={() => onMovePage(p, p - 1)} className={buttonClass.ghost}>
          <ArrowUp aria-hidden="true" className="size-3.5" />
        </button>
        <button type="button" aria-label={`Move page ${p + 1} down`} disabled={p === count - 1} onClick={() => onMovePage(p, p + 1)} className={buttonClass.ghost}>
          <ArrowDown aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Remove page ${p + 1}`}
          disabled={count <= 1 || !isEmpty}
          title={!isEmpty ? "Move or remove its questions first" : undefined}
          onClick={() => onRemovePage(p)}
          className={buttonClass.danger}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      {children}
      {/* Drop zone at the end of the page; also the only target of an empty page. */}
      <div
        ref={setNodeRef}
        className={`m-2 flex items-center justify-center rounded-lg border-2 border-dashed text-xs transition ${
          overEnd ? "border-brand-red bg-brand-red/5 text-brand-red" : dragging ? "border-gray-300 text-gray-500" : "border-transparent text-gray-400"
        } ${isEmpty || dragging ? "min-h-12" : "min-h-6"}`}
      >
        {isEmpty ? "Drop a question here" : dragging ? "Drop at the end of this page" : ""}
      </div>
    </div>
  );
}

function QuestionCard({
  id,
  question: q,
  active,
  flagged,
  dropBefore,
  onSelect,
  onRemove,
}: {
  id: string;
  question: Question;
  active: boolean;
  flagged: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const Icon = TYPE_ICONS[q.type];
  const required = q.required === true ? "Required" : typeof q.required === "object" ? "Sometimes required" : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex items-center gap-1 border-t border-gray-100 bg-white px-1 py-1.5 ${active ? "bg-brand-navy-900/10" : ""} ${isDragging ? "opacity-40" : ""}`}
    >
      {dropBefore && <span aria-hidden="true" className="absolute inset-x-1 -top-0.5 h-1 rounded-full bg-brand-red" />}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${q.id} to reorder`}
        className="cursor-grab touch-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-navy-900 active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1 font-mono text-[11px] text-gray-500">
          <Icon aria-hidden="true" className="size-3 text-brand-red" />
          {flagged && <AlertTriangle aria-label="Has problems" className="size-3 text-amber-600" />}
          {q.id}
        </span>
        <span className={`block truncate text-sm ${active ? "font-medium text-brand-navy-900" : "text-gray-800"}`}>{q.title}</span>
        {(required || q.visibleWhen) && (
          <span className="mt-0.5 flex gap-1">
            {required && <span className="rounded bg-red-50 px-1 text-[10px] text-red-700">{required}</span>}
            {q.visibleWhen && <span className="rounded bg-brand-navy-900/10 px-1 text-[10px] text-brand-navy-700">Conditional</span>}
          </span>
        )}
      </button>
      <button type="button" aria-label={`Remove ${q.id}`} onClick={onRemove} className={buttonClass.danger}>
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}
