import { createHash } from "node:crypto";

/** JSON with object keys sorted, so equal definitions always serialize identically. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** SHA-256 of the canonical JSON, recorded at publication as the version's content hash. */
export function definitionHash(definition: unknown): string {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}
