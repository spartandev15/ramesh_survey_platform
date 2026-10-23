import "server-only";
import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";

export type ActionOutcome = { ok: true } | { ok: false; message: string };

/**
 * The body of a server action. On success the given pages refresh in the same
 * response; the module's own error becomes its message, a permission error the
 * `denied` text, and anything else is thrown (an unexpected fault, never hidden).
 */
export async function act(body: () => Promise<unknown>, known: abstract new (...args: never[]) => Error, paths: string[], denied = "You do not have permission to do this."): Promise<ActionOutcome> {
  try {
    await body();
    for (const path of paths) revalidatePath(path);
    return { ok: true };
  } catch (error) {
    if (error instanceof known) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: denied };
    throw error;
  }
}
