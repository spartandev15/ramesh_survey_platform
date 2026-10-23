import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listInstruments } from "@/modules/instruments/instruments";
import { listVisibleShops } from "@/modules/shops/shops";
import { PSG_NAV } from "../nav";

export const metadata: Metadata = { title: "Search" };

// Lists that already search by words (?q=); the top bar search hands the words on to them.
const LISTS = [
  { href: "/psg/responses", label: "Responses" },
  { href: "/psg/alerts", label: "Alert review" },
  { href: "/psg/operations", label: "Operator queues" },
  { href: "/psg/invitations", label: "Invitations" },
  { href: "/psg/email", label: "Email review" },
  { href: "/psg/suppression", label: "Suppression queue" },
  { href: "/psg/legacy-cases", label: "Legacy cases" },
  { href: "/psg/readiness", label: "Launch readiness" },
];

const LIMIT = 10;

/** The top bar search: matching pages, shops and surveys, and the same words in every searchable list. */
export default async function SearchPage({ searchParams }: PageProps<"/psg/search">) {
  await pageRequireCapability("psg.workspace");
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 100);
  const has = (...texts: (string | null)[]) => texts.some((t) => t?.toLowerCase().includes(q.toLowerCase()));
  const [shops, surveys] = q ? await Promise.all([listVisibleShops(), listInstruments()]) : [[], []];
  const groups = [
    { title: "Pages", items: PSG_NAV.filter((n) => has(n.label)).map((n) => ({ href: n.href, label: n.label, note: "" })) },
    { title: "Shops", items: shops.filter((s) => has(s.name, s.publicSlug)).map((s) => ({ href: `/psg/shops/${s.id}`, label: s.name, note: `/survey/shop/${s.publicSlug}` })) },
    { title: "Surveys", items: surveys.filter((s) => has(s.name, s.key)).map((s) => ({ href: `/psg/instruments/${s.id}`, label: s.name, note: s.key })) },
  ];
  const found = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Search</h1>
        <p className="mt-1 text-sm text-gray-600">{q ? `${found} direct match${found === 1 ? "" : "es"} for “${q}”.` : "Type a shop, survey, page, customer or email in the search box at the top."}</p>
      </div>
      {q &&
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.title} aria-labelledby={`search-${g.title}`} className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
              <h2 id={`search-${g.title}`} className="px-5 pt-4 text-sm font-semibold text-brand-navy-900">
                {g.title}
                {g.items.length > LIMIT && <span className="ml-2 font-normal text-gray-500">first {LIMIT} of {g.items.length}</span>}
              </h2>
              <ul className="divide-y divide-gray-100 py-2">
                {g.items.slice(0, LIMIT).map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-brand-navy-900">{item.label}</span>
                        {item.note && <span className="block truncate text-xs text-gray-500">{item.note}</span>}
                      </span>
                      <ChevronRight aria-hidden="true" className="size-4 text-gray-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      {q && (
        <section aria-labelledby="search-lists" className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <h2 id="search-lists" className="text-sm font-semibold text-brand-navy-900">
            Look for “{q}” in
          </h2>
          <p className="mt-1 text-xs text-gray-500">Customers, emails, visits and cases live in these lists. Each opens already filtered by your words.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {LISTS.map((l) => (
              <Link key={l.href} href={`${l.href}?${new URLSearchParams({ q })}`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition hover:border-indigo-300 hover:text-indigo-700">
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
