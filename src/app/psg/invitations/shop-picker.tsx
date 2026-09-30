"use client";

import { useRouter } from "next/navigation";

/** Scales to many shops. A plain GET form, so it also works before scripts load. */
export function ShopPicker({ shops, shopId, view }: { shops: { id: string; name: string }[]; shopId: string; view: string }) {
  const router = useRouter();
  return (
    <form action="/psg/invitations" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="view" value={view} />
      <div className="flex flex-col gap-1">
        <label htmlFor="shop-picker" className="text-sm font-medium text-gray-700">
          Shop
        </label>
        <select
          id="shop-picker"
          name="shop"
          defaultValue={shopId}
          onChange={(e) => router.push(`/psg/invitations?shop=${e.target.value}&view=${view}`)}
          className="h-11 w-96 max-w-full rounded-xl border border-gray-200 bg-white px-3.5 text-sm shadow-sm outline-none focus:border-indigo-500"
        >
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <noscript>
        <button type="submit" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          Show
        </button>
      </noscript>
    </form>
  );
}
