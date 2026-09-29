/**
 * How the bridge reaches FileMaker. Records use Hub's own meaning, not
 * FileMaker field names: turning them into the approved FileMaker layout is
 * the adapter's job, written once the field map is approved (G-09). No
 * FileMaker field name is invented here.
 */

export type BridgeRecord = Record<string, unknown>;

export interface BridgeAdapter {
  readonly name: string;
  /** Create or update the record with this key; repeating it changes nothing more (idempotent). */
  upsert(key: string, record: BridgeRecord): Promise<{ externalId: string }>;
  /** The record as FileMaker holds it now, in the same Hub shape, or null when it does not exist. */
  read(externalId: string): Promise<BridgeRecord | null>;
}

/** The FileMaker connection. None exists until FileMaker access and the field map are provided (G-09). */
export function configuredAdapter(): BridgeAdapter | null {
  return null;
}

/**
 * In-memory stand-in for tests and dry runs. It can be taken offline and its
 * records edited "from FileMaker", to prove replay and conflict handling.
 */
export class MemoryBridgeAdapter implements BridgeAdapter {
  readonly name = "memory";
  readonly records = new Map<string, { key: string; record: BridgeRecord }>();
  offline = false;
  writes = 0;

  async upsert(key: string, record: BridgeRecord) {
    if (this.offline) throw new Error("FileMaker is not reachable");
    this.writes++;
    const externalId = `fm-${key}`;
    this.records.set(externalId, { key, record: structuredClone(record) });
    return { externalId };
  }

  async read(externalId: string) {
    if (this.offline) throw new Error("FileMaker is not reachable");
    const found = this.records.get(externalId);
    return found ? structuredClone(found.record) : null;
  }

  /** Simulate someone editing the record in FileMaker. */
  editInFileMaker(externalId: string, patch: BridgeRecord) {
    const found = this.records.get(externalId);
    if (found) found.record = { ...found.record, ...patch };
  }
}
