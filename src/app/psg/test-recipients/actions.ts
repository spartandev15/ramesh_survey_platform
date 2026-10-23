"use server";

import { act } from "@/lib/action";
import { addTestAllowlistEntry, removeTestAllowlistEntry } from "@/modules/shops/settings";
import { ShopSettingsError } from "@/modules/shops/settings-store";

function run(body: () => Promise<unknown>) {
  return act(body, ShopSettingsError, ["/psg/test-recipients"], "You do not have permission to change the test recipient list.");
}

export async function addEntryAction(entry: string, note: string) {
  return run(() => addTestAllowlistEntry(entry, note));
}

export async function removeEntryAction(id: string) {
  return run(() => removeTestAllowlistEntry(id));
}
