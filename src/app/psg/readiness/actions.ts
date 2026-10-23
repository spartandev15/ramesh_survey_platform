"use server";

import { act } from "@/lib/action";
import { confirmReadinessItem, withdrawReadinessItem } from "@/modules/readiness/readiness";
import { ReadinessError } from "@/modules/readiness/store";

// Refreshes the page the check was made on in the same response (no router.refresh needed).
function run(shopId: string, body: () => Promise<unknown>) {
  return act(body, ReadinessError, ["/psg/readiness", `/psg/shops/${shopId}`], "Only a PSG admin can record launch checks.");
}

export async function confirmItemAction(shopId: string, item: string, note: string) {
  return run(shopId, () => confirmReadinessItem(shopId, item, note));
}

export async function withdrawItemAction(shopId: string, item: string) {
  return run(shopId, () => withdrawReadinessItem(shopId, item));
}
