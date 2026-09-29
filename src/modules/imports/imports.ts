import "server-only";
import { getDb } from "@/db/client";
import { loadPage } from "@/lib/pagination";
import { requireCapability } from "@/modules/access/principal";
import type { ImportKind, Mapping } from "./mapping";
import * as store from "./store";

/** Authorized entry points for imports. PSG controls imports (SR-01, SR-06). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(id: string) {
  if (!UUID_RE.test(id)) throw new store.ImportError("not_found", "This import no longer exists.");
}

export async function uploadImport(input: { shopId: string; kind: ImportKind; isTest: boolean; sourceSystem: string; fileName: string; content: string }) {
  const { principal } = await requireCapability("import.manage");
  if (!UUID_RE.test(input.shopId)) throw new store.ImportError("not_found", "Choose a shop.");
  return getDb().transaction((tx) => store.createBatch(tx, { type: "user", userId: principal.userId }, input));
}

export async function listImports(page: number) {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => loadPage(page, () => store.countBatches(tx), (offset, size) => store.listBatches(tx, offset, size)));
}

export async function previewImport(batchId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(batchId)) return null;
  return getDb().transaction(async (tx) => {
    try {
      return await store.previewBatch(tx, batchId);
    } catch (error) {
      if (error instanceof store.ImportError && error.kind === "not_found") return null;
      throw error;
    }
  });
}

export async function saveImportMapping(batchId: string, expectedRevision: number, mapping: Mapping) {
  await requireCapability("import.manage");
  requireId(batchId);
  return getDb().transaction((tx) => store.setMapping(tx, batchId, expectedRevision, mapping));
}

export async function commitImport(batchId: string, expectedRevision: number) {
  const { principal } = await requireCapability("import.manage");
  requireId(batchId);
  return getDb().transaction((tx) => store.commitBatch(tx, { type: "user", userId: principal.userId }, batchId, expectedRevision));
}
