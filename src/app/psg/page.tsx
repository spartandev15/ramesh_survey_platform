import Link from "next/link";
import { countActiveShops } from "@/modules/shops/shops";

export default async function PsgOverviewPage() {
  const shops = await countActiveShops();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Overview</h1>
      <p className="mt-1 text-sm text-gray-500">Operational status across all shops.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Link href="/psg/shops" className="rounded-xl border border-gray-200 bg-white p-5 transition hover:border-brand-navy-700">
          <p className="text-sm text-gray-500">Active shops</p>
          <p className="mt-1 text-3xl font-semibold text-brand-navy-900">{shops}</p>
        </Link>
      </div>
    </div>
  );
}
