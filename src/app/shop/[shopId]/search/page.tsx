import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { searchShopCases } from "@/modules/cases/cases";

export const metadata: Metadata = { title: "Search" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** The top bar search in a shop's workspace: its pages, and follow-up cases by what the customer raised. */
export default async function ShopSearchPage({ params, searchParams }: PageProps<"/shop/[shopId]/search">) {
  const { shopId } = await params;
  await pageRequireShopRead(shopId);
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 100);
  const pages = [
    { href: `/shop/${shopId}`, label: "Survey dashboard", note: "Scores, trends and every response" },
    { href: `/shop/${shopId}/cases`, label: "Follow-up", note: "Customer feedback PSG asked you to follow up" },
  ].filter((p) => q && `${p.label} ${p.note}`.toLowerCase().includes(q.toLowerCase()));
  const cases = q ? await searchShopCases(shopId, q) : [];
  const items = [
    ...pages,
    ...cases.map((c) => ({
      href: `/shop/${shopId}/cases/${c.id}`,
      label: (c.alerts as { label: string }[]).map((a) => a.label).join("; "),
      note: `Follow-up case from ${dateTime.format(c.createdAt)}${c.followUp === "resolved" ? " · resolved" : ""}`,
    })),
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Search</h1>
        <p className="mt-1 text-sm text-gray-600">{q ? `${items.length} match${items.length === 1 ? "" : "es"} for “${q}”.` : "Type a page name or what a customer raised, such as “late” or “communication”, in the search box at the top."}</p>
      </div>
      {items.length > 0 && (
        <ul aria-label="Search results" className="divide-y divide-gray-100 rounded-2xl border border-gray-200/80 bg-white py-2 shadow-sm">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-brand-navy-900">{item.label}</span>
                  <span className="block truncate text-xs text-gray-500">{item.note}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
