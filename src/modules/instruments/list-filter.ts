/**
 * Search, filters and sort for the survey list. Pure, so it is unit-tested.
 * A survey's list status comes from its versions: "Test only" when its
 * latest published version is a test version, "Published" when it is a
 * verified one, "Draft" when nothing is published yet.
 */
export const SURVEY_STATUSES = { all: "All statuses", published: "Published", draft: "Draft", test: "Test only" } as const;
export const SURVEY_TYPES = { all: "All types", core: "Scored survey", addition: "Shop questions" } as const;
export const SURVEY_SORTS = { published: "Latest published", name: "Name A to Z", newest: "Newest first" } as const;

export type SurveyStatus = Exclude<keyof typeof SURVEY_STATUSES, "all">;

export interface SurveyListFilters {
  q: string;
  status: keyof typeof SURVEY_STATUSES;
  type: keyof typeof SURVEY_TYPES;
  sort: keyof typeof SURVEY_SORTS;
}

interface ListedSurvey {
  id: string;
  name: string;
  key: string;
  description: string | null;
  shopId: string | null;
  createdAt: Date;
  versions: { status: "draft" | "published"; isTest: boolean; version: number; publishedAt: Date | null }[];
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends Record<string, string>>(value: string, options: T, fallback: keyof T): keyof T => (value in options ? value : fallback);

export function parseSurveyFilters(params: Params): SurveyListFilters {
  return {
    q: one(params.q).trim().slice(0, 100),
    status: pick(one(params.status), SURVEY_STATUSES, "all"),
    type: pick(one(params.type), SURVEY_TYPES, "all"),
    sort: pick(one(params.sort), SURVEY_SORTS, "published"),
  };
}

/** The latest published version (highest number), if any. */
export function latestPublished<T extends ListedSurvey["versions"][number]>(versions: T[]): T | undefined {
  return versions.filter((v) => v.status === "published").sort((a, b) => b.version - a.version)[0];
}

export function surveyStatus(survey: Pick<ListedSurvey, "versions">): SurveyStatus {
  const published = latestPublished(survey.versions);
  return !published ? "draft" : published.isTest ? "test" : "published";
}

export function filterSurveys<T extends ListedSurvey>(surveys: T[], f: SurveyListFilters): T[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = surveys.filter((s) => {
    if (f.status !== "all" && surveyStatus(s) !== f.status) return false;
    if (f.type === "core" && s.shopId) return false;
    if (f.type === "addition" && !s.shopId) return false;
    const text = `${s.name} ${s.key} ${s.description ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);
  const publishedAt = (s: T) => latestPublished(s.versions)?.publishedAt?.getTime() ?? 0;
  const order = {
    name: byName,
    newest: (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b),
    published: (a: T, b: T) => publishedAt(b) - publishedAt(a) || byName(a, b),
  }[f.sort];
  return kept.sort(order);
}
