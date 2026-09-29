import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getShopSettingsPage } from "@/modules/shops/settings";
import { SHOP_MODES, modeChangeIssues, todayInTimezone, type ShopMode } from "@/modules/shops/settings-policy";
import { MODE_LABELS } from "@/modules/shops/fields";
import type { AssignedVersion, SettingsHistoryRow } from "@/modules/shops/settings-store";
import { DeleteShopButton } from "../delete-shop";
import { ModeBadge } from "../mode-badge";
import { PublicLink } from "../public-link";
import { env } from "@/lib/env";
import { getShopReadiness } from "@/modules/readiness/readiness";
import { listMembers } from "@/modules/shops/members";
import { Checklist } from "../../readiness/checklist";
import { ShopAdditions } from "./additions";
import { LegacyCoverage } from "./legacy-coverage";
import { ShopMembers } from "./members";
import { ModeControl } from "./mode-control";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Shop settings" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function versionLabel(v: Pick<AssignedVersion, "instrumentName" | "version" | "isTest">) {
  return `${v.instrumentName} v${v.version}${v.isTest ? " (TEST)" : ""}`;
}

const FIELD_LABELS: Record<string, string> = {
  mode: "Mode",
  deliveryCutoff: "Delivery cutoff",
  instrumentVersionId: "Survey version",
  additionVersionId: "Shop questions",
  reminderDelayDays: "Reminder delay (days)",
  linkLifetimeDays: "Link lifetime (days)",
  alertRecipients: "Alert recipients",
  timezone: "Timezone",
  logoUrl: "Logo",
  brandColor: "Brand colour",
  legacyCoverage: "Legacy history confirmed",
};

function describeChange(row: SettingsHistoryRow, versionNames: Map<string, string>): string[] {
  if (row.action === "shop.created") return ["Shop created in Test mode"];
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const show = (key: string, value: unknown) => {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return "not set";
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (key === "mode") return MODE_LABELS[value as ShopMode] ?? String(value);
    if (key === "instrumentVersionId" || key === "additionVersionId") return versionNames.get(String(value)) ?? "an unpublished version";
    return Array.isArray(value) ? value.join(", ") : String(value);
  };
  if (row.action === "shop.mode_changed") return [`Mode: ${show("mode", before.mode)} → ${show("mode", after.mode)}`];
  return Object.keys(after).map((key) => `${FIELD_LABELS[key] ?? key}: ${show(key, before[key])} → ${show(key, after[key])}`);
}

export default async function ShopSettingsPage({ params, searchParams }: PageProps<"/psg/shops/[shopId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "shop.manage");
  const { shopId } = await params;
  // Independent loads run together; only readiness needs the shop first.
  const [data, allMembers, query] = await Promise.all([getShopSettingsPage(shopId), listMembers(shopId), searchParams]);
  if (!data) notFound();
  const members = pageOf(allMembers, pageNumber(query.mpage), 10);

  const { shop, settings, version, versions, history, additions } = data;
  const changes = pageOf(history, pageNumber(query.hpage), 10);
  const additionChoices = additions.filter((a) => a.status === "published").map((a) => ({ id: a.id, label: `Shop questions v${a.version}${a.isTest ? " (TEST)" : ""}` }));
  const canManageUsers = hasCapability(current.principal, "user.manage");
  // Internal test shops have no launch checklist (they never go Live).
  const readiness = shop.isTestShop ? null : await getShopReadiness(shop.id);
  const versionNames = new Map([...versions.map((v) => [v.id, versionLabel(v)] as const), ...additionChoices.map((a) => [a.id, a.label] as const)]);
  const context = {
    mode: settings.mode,
    isTestShop: shop.isTestShop,
    activatedAt: settings.activatedAt,
    deliveryCutoff: settings.deliveryCutoff,
    version,
  };
  // Only offer changes that could ever apply; blocked ones explain what is missing.
  const options = SHOP_MODES.filter((m) => m !== settings.mode)
    .map((target) => ({ target, issues: modeChangeIssues(context, target) }))
    .filter((o) => !(o.target === "test" && settings.activatedAt) && !(o.target === "paused" && settings.mode !== "live") && !(o.target !== "test" && shop.isTestShop));

  return (
    <div className="max-w-6xl">
      <Link href="/psg/shops" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Shops
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">{shop.name}</h1>
        <ModeBadge mode={settings.mode} />
        {shop.isTestShop && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Internal test shop</span>}
        {canManage && (
          <div className="ml-auto">
            <DeleteShopButton shopId={shop.id} name={shop.name} afterDelete="/psg/shops" large />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        Public survey link:
        <a href={`/survey/shop/${shop.publicSlug}`} target="_blank" rel="noreferrer" className="font-mono text-brand-navy-900 underline-offset-2 hover:underline">
          /survey/shop/{shop.publicSlug}
        </a>
        <PublicLink shopId={shop.id} name={shop.name} slug={shop.publicSlug} url={`${env().APP_URL.replace(/\/$/, "")}/survey/shop/${shop.publicSlug}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="mode-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="mode-heading" className="text-base font-semibold text-brand-navy-900">
              Mode
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-gray-500">Current mode</dt>
                <dd className="text-gray-900">{MODE_LABELS[settings.mode]}</dd>
              </div>
              <div>
                <dt className="text-gray-500">First activated</dt>
                <dd className="text-gray-900">{settings.activatedAt ? dateTime.format(settings.activatedAt) : "Never"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Live since</dt>
                <dd className="text-gray-900">{settings.liveSince ? dateTime.format(settings.liveSince) : "Not Live"}</dd>
              </div>
            </dl>
            {shop.isTestShop && <p className="mt-3 text-sm text-gray-600">This is an internal test shop. It always stays in Test mode and its data never enters production reports.</p>}
            {canManage && options.length > 0 && (
              <div className="mt-4">
                <ModeControl
                  shopId={shop.id}
                  revision={settings.revision}
                  mode={settings.mode}
                  options={options}
                  summary={{
                    deliveryCutoff: settings.deliveryCutoff,
                    versionLabel: version ? versionLabel(version) : null,
                    timezone: shop.timezone,
                  }}
                />
              </div>
            )}
          </section>

          {readiness && (
            <section id="readiness" aria-labelledby="readiness-heading" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="readiness-heading" className="text-base font-semibold text-brand-navy-900">
                  Launch readiness
                </h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${readiness.shop.ready ? "bg-emerald-100 text-emerald-800" : "bg-brand-red/10 text-brand-red-dark"}`}>
                  {readiness.shop.ready ? "Ready" : `${readiness.shop.missing.length} missing`}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                What must be true before this shop goes Live. Ready does not switch the mode.{" "}
                <Link href="/psg/readiness" className="text-brand-navy-900 underline-offset-2 hover:underline">
                  All shops
                </Link>
              </p>
              {readiness.email.some((c) => c.status === "fail") && <p className="mt-2 text-xs text-brand-red-dark">Email sending is not set up yet, so no shop can be ready. See All shops.</p>}
              <div className="mt-2">
                <Checklist shopId={shop.id} checks={readiness.shop.checks} canManage={canManage} />
              </div>
            </section>
          )}

          {!shop.isTestShop && (
            <section aria-labelledby="legacy-heading" className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 id="legacy-heading" className="text-base font-semibold text-brand-navy-900">
                Legacy survey history
              </h2>
              <div className="mt-3">
                <LegacyCoverage shopId={shop.id} revision={settings.revision} confirmedAt={settings.legacyCoverageConfirmedAt?.toISOString() ?? null} canManage={canManage} />
              </div>
            </section>
          )}

          <section aria-labelledby="additions-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="additions-heading" className="text-base font-semibold text-brand-navy-900">
              Shop questions
            </h2>
            <p className="mt-1 text-xs text-gray-500">Optional questions only this shop&apos;s customers see, after the shared survey. They never change shared scores or alerts.</p>
            <div className="mt-3">
              <ShopAdditions
                shopId={shop.id}
                revision={settings.revision}
                instrumentId={additions[0]?.instrumentId ?? null}
                assignedId={settings.additionVersionId}
                choices={additionChoices}
                canManage={canManage && hasCapability(current.principal, "instrument.manage")}
              />
            </div>
          </section>

          <section aria-label="Settings" className="rounded-xl border border-gray-200 bg-white p-5">
            <SettingsForm
              shopId={shop.id}
              shopName={shop.name}
              revision={settings.revision}
              canManage={canManage}
              suggestedCutoff={todayInTimezone(shop.timezone)}
              versions={versions.map((v) => ({
                id: v.id,
                label: versionLabel(v),
                isTest: v.isTest,
              }))}
              initial={{
                instrumentVersionId: settings.instrumentVersionId ?? "",
                deliveryCutoff: settings.deliveryCutoff ?? "",
                timezone: shop.timezone,
                reminderDelayDays: String(settings.reminderDelayDays),
                linkLifetimeDays: String(settings.linkLifetimeDays),
                alertRecipients: settings.alertRecipients.join("\n"),
                logoUrl: shop.logoUrl ?? "",
                brandColor: shop.brandColor ?? "",
              }}
            />
          </section>
        </div>

        <div className="flex h-fit flex-col gap-6">
          <section aria-labelledby="members-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="members-heading" className="text-base font-semibold text-brand-navy-900">
              Shop users
            </h2>
            <p className="mt-1 text-xs text-gray-500">These people see this shop&apos;s dashboard and nothing from other shops.</p>
            <div className="mt-3">
              <ShopMembers shopId={shop.id} members={members.items} canManage={canManageUsers} />
              <Pagination {...members} path={`/psg/shops/${shop.id}`} query={query} param="mpage" anchor="members-heading" label="Shop user pages" />
            </div>
          </section>
          <section aria-labelledby="history-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="history-heading" className="text-base font-semibold text-brand-navy-900">
              Activation and settings history
            </h2>
            {changes.total === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No changes recorded yet.</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-3">
                {changes.items.map((row) => (
                  <li key={row.id} className="border-l-2 border-gray-200 pl-3 text-sm">
                    <p className="text-xs text-gray-500">
                      {dateTime.format(row.occurredAt)} · {row.actorName ?? "System"}
                    </p>
                    <ul className="mt-0.5 text-gray-800">
                      {describeChange(row, versionNames).map((line) => (
                        <li key={line} className="break-words">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            <Pagination {...changes} path={`/psg/shops/${shop.id}`} query={query} param="hpage" anchor="history-heading" label="History pages" />
          </section>
        </div>
      </div>
    </div>
  );
}
