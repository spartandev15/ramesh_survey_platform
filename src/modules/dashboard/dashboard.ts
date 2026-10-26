import "server-only";
import { getDb } from "@/db/client";
import { pageOf } from "@/lib/pagination";
import { requireShopRead } from "@/modules/access/principal";
import { formatAnswer } from "@/modules/instruments/describe";
import { recordAudit } from "@/modules/audit/audit";
import { answerFilterOptions, describeAnswerFilter, questionResults, type QuestionResult } from "./answers";
import { CATEGORY_LABELS, DATE_BASIS_LABELS, SOURCE_FILTER_LABELS, categorize, localDate, parseFilters, summarize, type Category, type DashboardFilters } from "./cohort";
import { toCsv } from "@/lib/csv";
import * as store from "./store";

/**
 * Shop dashboard and export (SR-27, SR-30, SR-31). Both read one cohort, so
 * the export always reconciles to the screen (AT-31). Every entry point
 * checks shop access first: another shop's id is simply not found (AT-01, AT-27).
 */

/** Which responses the list under the charts shows; the charts always use the whole view. */
export const LIST_VIEWS = { all: "All", counted: "Counted", pending: "Pending match", negative: "Negative feedback", not_counted: "Not counted" } as const;
export type ListView = keyof typeof LIST_VIEWS;

/** Ten responses per page, so the list under the charts stays short. */
const LIST_PAGE_SIZE = 10;

export function listView(value: string | string[] | undefined): ListView {
  return typeof value === "string" && value in LIST_VIEWS ? (value as ListView) : "all";
}

function inListView(view: ListView, category: Category, hasAlerts: boolean) {
  switch (view) {
    case "counted":
      return category === "counted";
    case "pending":
      return category === "pending_match";
    case "negative":
      return hasAlerts;
    case "not_counted":
      return category !== "counted" && category !== "pending_match";
    default:
      return true;
  }
}

export async function getDashboard(shopId: string, filters: DashboardFilters, page = 1, view: ListView = "all") {
  await requireShopRead(shopId);
  return getDb().transaction(async (tx) => {
    const shop = await store.shopForDashboard(tx, shopId);
    if (!shop) return null;
    // Answers come in the same read as the scores, so the question results and the scores always use the same revision.
    const rows = await store.cohortRows(tx, shopId, filters, shop.timezone);
    // One connection per transaction: these run one after another, never in parallel.
    const versions = await store.versionDetails(tx, [...new Set(rows.map((r) => r.versionId))]);
    const versionOptions = await store.shopVersions(tx, shopId);
    const drafts = await store.draftCount(tx, shopId);
    const history = await store.historicalSummary(tx, shopId, filters.from, filters.to);
    const summary = summarize(rows, shop.isTestShop, versions, shop.timezone, filters);
    // Question results for the version the scores show, from the same counted responses.
    const main = summary.groups[0];
    const mainVersion = main ? versions.get(main.versionId) : undefined;
    const questions: QuestionResult[] =
      main && mainVersion
        ? questionResults(
            mainVersion.definition,
            rows.filter((r) => r.versionId === main.versionId && categorize(r, shop.isTestShop) === "counted"),
          )
        : [];
    // The Answer filter offers the questions of the version on screen; with nothing on screen, the chosen or any version the shop has, so a filter that empties the view can still be changed.
    const optionsFrom = mainVersion?.definition ?? (versionOptions.find((v) => v.id === filters.version) ?? versionOptions[0])?.definition;
    const answerOptions = optionsFrom ? answerFilterOptions(optionsFrom) : [];
    const answerLabel = filters.answer ? describeAnswerFilter(filters.answer, versionOptions.map((v) => v.definition)) : null;
    // The scores and charts use every row; the list below them shows one page of the chosen view.
    const listPage = pageOf(
      rows.filter((r) => inListView(view, categorize(r, shop.isTestShop), r.alerts.length > 0)),
      page,
      LIST_PAGE_SIZE,
    );
    const items = listPage.items.map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      source: r.source,
      isTest: r.isTest,
      category: categorize(r, shop.isTestShop),
      versionLabel: versions.get(r.versionId)?.label ?? "",
      alerts: r.alerts.map((a) => a.label),
      corrected: r.revision > 1,
    }));
    return {
      shop,
      filters,
      today: localDate(new Date(), shop.timezone),
      summary,
      questions,
      questionsVersion: main ? { id: main.versionId, label: main.label } : null,
      answerOptions,
      answerLabel,
      list: { ...listPage, items },
      listView: view,
      versionOptions: versionOptions.map((v) => ({ id: v.id, label: v.label })),
      drafts,
      history,
    };
  });
}

/**
 * The same cohort as the dashboard, one row per submitted response, with a
 * column saying whether it counts. Answers export under stable question ids.
 * Default dates use the shop's own calendar, as on screen; every row names the
 * date basis and filters it came from (SR-31), and each export is audited.
 */
export async function exportCsv(shopId: string, params: Record<string, string>, now = new Date()) {
  const current = await requireShopRead(shopId);
  return getDb().transaction(async (tx) => {
    const shop = await store.shopForDashboard(tx, shopId);
    if (!shop) return null;
    const filters = parseFilters(params, localDate(now, shop.timezone));
    const rows = await store.cohortRows(tx, shopId, filters, shop.timezone);
    const versions = await store.versionDetails(tx, [...new Set(rows.map((r) => r.versionId))]);

    // The shop's own questions export under their stable add_ ids, after the shared ones (AT-45).
    const additions = await store.versionDetails(tx, [...new Set(rows.flatMap((r) => (r.additionVersionId ? [r.additionVersionId] : [])))]);

    const metricIds = [...new Set([...versions.values()].flatMap((v) => v.metrics.map((m) => m.id)))];
    const questions = [...new Map([...versions.values(), ...additions.values()].flatMap((v) => v.definition.pages.flatMap((p) => p.questions)).map((q) => [q.id, q])).values()];
    const header = [
      "response_id",
      "submitted_local_date",
      "delivered_on",
      "source",
      "status",
      "counted",
      "survey_version",
      "test_data",
      "corrected",
      ...metricIds.map((id) => `metric:${id}`),
      "alerts",
      ...questions.map((q) => `answer:${q.id}`),
      "report_date_basis",
      "report_from",
      "report_to",
      "report_source",
      "report_version",
      "report_answer",
    ];
    const versionFilter = filters.version === "all" ? "All versions" : ((await store.versionDetails(tx, [filters.version])).get(filters.version)?.label ?? filters.version);
    const answerFilter = filters.answer ? describeAnswerFilter(filters.answer, (await store.shopVersions(tx, shopId)).map((v) => v.definition)) : "Any answer";
    const report = [DATE_BASIS_LABELS[filters.basis], filters.from, filters.to, SOURCE_FILTER_LABELS[filters.source], versionFilter, answerFilter];
    const body = rows.map((r) => {
      const category = categorize(r, shop.isTestShop);
      return [
        r.id,
        localDate(r.submittedAt, shop.timezone),
        r.deliveredOn ?? "",
        r.source,
        CATEGORY_LABELS[category],
        category === "counted" ? "yes" : "no",
        versions.get(r.versionId)?.label ?? r.versionId,
        r.isTest ? "yes" : "no",
        r.revision > 1 ? "yes" : "no",
        ...metricIds.map((id) => r.metrics[id] ?? ""),
        r.alerts.map((a) => a.label).join("; "),
        ...questions.map((q) => formatAnswer(q, r.answers[q.id]) ?? ""),
        ...report,
      ];
    });
    await recordAudit(
      { actorType: "user", actorUserId: current.principal.userId, shopId, action: "survey_results.exported", subjectType: "shop", subjectId: shopId, after: { ...filters, rows: rows.length } },
      tx,
    );
    const name = `${shop.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "shop"}-survey-results-${filters.from}-to-${filters.to}.csv`;
    return { csv: toCsv(header, body), fileName: name, rows: rows.length };
  });
}

export async function getShopResponse(shopId: string, responseId: string) {
  await requireShopRead(shopId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(responseId)) return null;
  return getDb().transaction(async (tx) => {
    const shop = await store.shopForDashboard(tx, shopId);
    if (!shop) return null;
    const response = await store.shopResponse(tx, shopId, responseId, shop.isTestShop);
    return response ? { shop, response } : null;
  });
}
