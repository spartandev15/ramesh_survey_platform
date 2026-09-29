"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { commitImport, saveImportMapping, uploadImport } from "@/modules/imports/imports";
import type { Mapping } from "@/modules/imports/mapping";
import { ImportError, MAX_IMPORT_BYTES } from "@/modules/imports/store";

export type ImportActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; issues?: string[] };

function failure(error: unknown): ImportActionResult<never> {
  if (error instanceof ImportError) return { ok: false, message: error.message, issues: error.issues };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to import records." };
  throw error;
}

export async function uploadImportAction(formData: FormData): Promise<ImportActionResult<{ batchId: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file to upload." };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: "The file is larger than 5 MB. Split it into smaller files." };
  const requested = formData.get("kind");
  const kind = requested === "legacy_ledger" || requested === "legacy_cases" || requested === "opt_outs" ? requested : "visits";
  try {
    const batch = await uploadImport({
      shopId: String(formData.get("shopId") ?? ""),
      kind,
      isTest: formData.get("dataType") === "test",
      sourceSystem: String(formData.get("sourceSystem") ?? ""),
      fileName: file.name,
      content: await file.text(),
    });
    revalidatePath("/psg/imports");
    return { ok: true, batchId: batch.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveMappingAction(batchId: string, expectedRevision: number, mapping: Mapping): Promise<ImportActionResult<{ revision: number }>> {
  try {
    const saved = await saveImportMapping(batchId, expectedRevision, mapping);
    revalidatePath(`/psg/imports/${batchId}`);
    return { ok: true, revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function commitImportAction(batchId: string, expectedRevision: number): Promise<ImportActionResult> {
  try {
    await commitImport(batchId, expectedRevision);
    revalidatePath("/psg/imports");
    revalidatePath(`/psg/imports/${batchId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
