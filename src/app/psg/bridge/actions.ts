"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { addBridgeDependency, confirmBridgeGate, keepHubVersion, retryBridgeEvent, setBridgeDependencyStatus, signBridgeRetirement, withdrawBridgeGate } from "@/modules/bridge/bridge";
import { BridgeError } from "@/modules/bridge/store";

export type BridgeActionResult = { ok: true } | { ok: false; message: string };

async function run(body: () => Promise<unknown>): Promise<BridgeActionResult> {
  try {
    await body();
    // Refreshes this page in the same response.
    revalidatePath("/psg/bridge");
    return { ok: true };
  } catch (error) {
    if (error instanceof BridgeError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "You do not have permission to do this." };
    throw error;
  }
}

export async function confirmGateAction(item: string, note: string) {
  return run(() => confirmBridgeGate(item, note));
}

export async function withdrawGateAction(item: string) {
  return run(() => withdrawBridgeGate(item));
}

export async function addDependencyAction(name: string, uses: string) {
  return run(() => addBridgeDependency(name, uses));
}

export async function dependencyStatusAction(id: string, status: string, outcome: string) {
  return run(() => setBridgeDependencyStatus(id, status, outcome));
}

export async function signRetirementAction(fileMakerOwner: string, note: string) {
  return run(() => signBridgeRetirement(fileMakerOwner, note));
}

export async function retryAction(eventId: string) {
  return run(() => retryBridgeEvent(eventId));
}

export async function keepHubAction(eventId: string, note: string) {
  return run(() => keepHubVersion(eventId, note));
}
