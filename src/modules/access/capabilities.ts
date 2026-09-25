/**
 * Role and capability model. Pure logic with no I/O so it is exhaustively
 * unit-tested; server code loads a Principal and asks these functions.
 *
 * PDF SR-01: PSG controls setup, branding, publishing, imports, corrections,
 * alert approval and resolution; shop users see only their authorized shops
 * and may add notes / request closure.
 *
 * The split of PSG work across admin/operator/reviewer below is a proposal
 * (not stated in the PDF) and must be confirmed with PSG at kickoff.
 */

export type PsgRole = "psg_admin" | "psg_operator" | "psg_reviewer";

export const CAPABILITIES = [
  "psg.workspace", // open the PSG workspace and see all shops
  "user.manage",
  "shop.manage", // shop setup, branding, mode, cutoff (SR-02..SR-05)
  "instrument.manage", // draft, preview, publish survey versions (SR-15, SR-44)
  "import.manage", // imports and explicit sends (SR-06..SR-11)
  "response.paper_entry", // SR-18
  "response.correct", // SR-20
  "match.manage", // matching, duplicates, shop suggestions (SR-19, SR-28, SR-29)
  "alert.review", // review, approve and send negative alerts (SR-32, SR-33)
  "case.resolve", // final resolution (SR-34)
  "suppression.acknowledge", // manual FileMaker suppression queue (SR-36)
  "operations.view", // operator queues (SR-38)
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<PsgRole, readonly Capability[]> = {
  psg_admin: CAPABILITIES,
  psg_operator: [
    "psg.workspace",
    "import.manage",
    "response.paper_entry",
    "response.correct",
    "match.manage",
    "suppression.acknowledge",
    "operations.view",
  ],
  psg_reviewer: ["psg.workspace", "alert.review", "case.resolve", "operations.view"],
};

export interface Principal {
  userId: string;
  psgRoles: readonly PsgRole[];
  /** Shops the user belongs to as a shop user. */
  shopIds: readonly string[];
}

export function isPsgStaff(p: Principal): boolean {
  return p.psgRoles.length > 0;
}

export function hasCapability(p: Principal, capability: Capability): boolean {
  return p.psgRoles.some((role) => ROLE_CAPABILITIES[role].includes(capability));
}

/**
 * Read access to one shop's data. PSG staff may see every shop; shop users only
 * their memberships. Callers must still scope queries by the shop id they pass.
 */
export function canReadShop(p: Principal, shopId: string): boolean {
  return isPsgStaff(p) || p.shopIds.includes(shopId);
}

/** Shop users may add notes and request closure on their own shop's cases (SR-34). */
export function canParticipateInShopCase(p: Principal, shopId: string): boolean {
  return canReadShop(p, shopId);
}
