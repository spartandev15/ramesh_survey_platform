import { createHash } from "node:crypto";

/**
 * Temporary FileMaker bridge (SR-41..SR-43): an outbound, idempotent copy of
 * required Hub records. Hub stays the owner: nothing read from FileMaker ever
 * changes Hub. Pure rules, unit-tested; the store and cycle apply them.
 */

export const ENTITY_TYPES = ["response", "case", "suppression"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const EVENT_STATES = ["pending", "retrying", "failed", "conflict", "confirmed", "superseded"] as const;
export type EventState = (typeof EVENT_STATES)[number];

export const STATE_LABELS: Record<EventState, string> = {
  pending: "Waiting to send",
  retrying: "Retrying",
  failed: "Failed",
  conflict: "Changed in FileMaker: needs review",
  confirmed: "Confirmed by read-back",
  superseded: "Replaced by a newer version",
};

/**
 * PSG-recorded checks before any write (SR-42, G-09, PDF 09 "R2 bridge
 * enablement"). The switch itself is the last one.
 */
export const GATES = ["field_map", "alert_exclusion", "sandbox_test", "writes_enabled"] as const;
export type Gate = (typeof GATES)[number];

export const isGate = (value: string): value is Gate => (GATES as readonly string[]).includes(value);

export const GATE_LABELS: Record<Gate, { label: string; help: string }> = {
  field_map: { label: "Field map approved", help: "PSG and the FileMaker owner approved which FileMaker file, table and field each Hub value goes to (G-09)." },
  alert_exclusion: {
    label: "Legacy alerts skip Hub records",
    help: "FileMaker scripts were checked: records marked as coming from Hub never send a FileMaker alert, and legacy records still follow their workflow (SR-42).",
  },
  sandbox_test: { label: "Sandbox write tested", help: "A write, read-back, repeat and outage were tried against a FileMaker test copy." },
  writes_enabled: { label: "Writes switched on", help: "Final switch. Only after every check above; withdraw it to stop all writes at once." },
};

/** Every value FileMaker receives carries this marker, so its scripts can tell Hub records apart (SR-42). */
export const SOURCE_MARKER = "hub";

/** Stable key per Hub record: repeating a write updates the same FileMaker record (AT-41). */
export const recordKey = (entity: EntityType, entityId: string) => `${SOURCE_MARKER}:${entity}:${entityId}`;

/** Order-independent hash, so the same content always hashes the same. */
export function payloadHash(payload: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
          )
        : value;
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

export type BridgeReadiness = { enabled: true } | { enabled: false; reasons: string[] };

export function readiness(adapterConfigured: boolean, confirmedGates: ReadonlySet<Gate>): BridgeReadiness {
  const reasons: string[] = [];
  if (!adapterConfigured) reasons.push("No FileMaker connection is set up yet. It needs FileMaker access and the approved field map from PSG (G-09).");
  for (const gate of GATES) if (!confirmedGates.has(gate)) reasons.push(`Not recorded yet: ${GATE_LABELS[gate].label}.`);
  return reasons.length === 0 ? { enabled: true } : { enabled: false, reasons };
}

export const MAX_ATTEMPTS = 8;

/**
 * After a failed or unclear write. The write is an idempotent upsert by
 * record key, so trying again is safe; it backs off, then waits for a person.
 */
export function afterError(attempts: number, now: Date): { state: "retrying"; nextAttemptAt: Date } | { state: "failed" } {
  if (attempts >= MAX_ATTEMPTS) return { state: "failed" };
  return { state: "retrying", nextAttemptAt: new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60 * 1000) };
}

/**
 * Before writing over an existing FileMaker record: if it no longer holds
 * what Hub last confirmed there, someone changed it in FileMaker. Hub does
 * not overwrite it silently; the event is quarantined for PSG (SR-43).
 */
export function editedInFileMaker(current: unknown | null, lastConfirmedHash: string | null): boolean {
  if (current === null || lastConfirmedHash === null) return false;
  return payloadHash(current) !== lastConfirmedHash;
}
