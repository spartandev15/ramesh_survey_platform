import "server-only";
import { getDb } from "@/db/client";
import { hasCapability } from "@/modules/access/capabilities";
import { requireCapability, requireShopRead } from "@/modules/access/principal";
import { caseCounts } from "@/modules/cases/cases";
import { countOpenShopCases } from "@/modules/cases/store";
import { operatorQueueSummary } from "@/modules/operations/operations";

export interface Notice {
  label: string;
  count: number;
  href: string;
}

/** What needs this person now, for the bell in the top bar. Only what is waiting; nothing when all is done. */
export async function noticesFor(shopId: string | null): Promise<Notice[]> {
  if (shopId) {
    await requireShopRead(shopId);
    const open = await getDb().transaction((tx) => countOpenShopCases(tx, shopId));
    return open > 0 ? [{ label: "Follow-up cases open", count: open, href: `/shop/${shopId}/cases` }] : [];
  }
  const { principal } = await requireCapability("psg.workspace");
  const cases = await caseCounts();
  const notices: Notice[] = [
    { label: "Negative feedback to review", count: cases.review, href: "/psg/alerts" },
    { label: "Closure requests from shops", count: cases.closure, href: "/psg/alerts?view=closure_requested" },
  ];
  if (hasCapability(principal, "operations.view")) {
    const { overdue, health } = await operatorQueueSummary();
    notices.push(
      { label: "Operator items overdue", count: overdue, href: "/psg/operations" },
      { label: "Survey emails to review", count: health.email.problems, href: "/psg/email" },
      { label: "Background worker not running", count: health.worker.healthy ? 0 : 1, href: "/psg/operations?kind=worker" },
      { label: "FileMaker bridge problems", count: health.bridge.problems, href: "/psg/bridge" },
    );
  }
  return notices.filter((n) => n.count > 0);
}
