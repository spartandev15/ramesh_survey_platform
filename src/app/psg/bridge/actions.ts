"use server";

import { act } from "@/lib/action";
import { addBridgeDependency, confirmBridgeGate, keepHubVersion, retryBridgeEvent, setBridgeDependencyStatus, signBridgeRetirement, withdrawBridgeGate } from "@/modules/bridge/bridge";
import { BridgeError } from "@/modules/bridge/store";

// Refreshes this page in the same response.
function run(body: () => Promise<unknown>) {
  return act(body, BridgeError, ["/psg/bridge"]);
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
