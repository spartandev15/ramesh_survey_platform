import { describe, expect, it } from "vitest";
import { CAPABILITIES, canReadShop, hasCapability, isPsgStaff, type Principal } from "./capabilities";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";

const principal = (overrides: Partial<Principal>): Principal => ({ userId: "u1", psgRoles: [], shopIds: [], ...overrides });

describe("shop isolation (AT-01)", () => {
  it("lets a shop user read only their own shop", () => {
    const shopUser = principal({ shopIds: [SHOP_A] });
    expect(canReadShop(shopUser, SHOP_A)).toBe(true);
    expect(canReadShop(shopUser, SHOP_B)).toBe(false);
  });

  it("gives a user with no roles or memberships no access", () => {
    const nobody = principal({});
    expect(isPsgStaff(nobody)).toBe(false);
    expect(canReadShop(nobody, SHOP_A)).toBe(false);
    for (const capability of CAPABILITIES) expect(hasCapability(nobody, capability)).toBe(false);
  });

  it("lets PSG staff read every shop", () => {
    const reviewer = principal({ psgRoles: ["psg_reviewer"] });
    expect(canReadShop(reviewer, SHOP_A)).toBe(true);
    expect(canReadShop(reviewer, SHOP_B)).toBe(true);
  });
});

describe("PSG capabilities (SR-01)", () => {
  it("grants a shop user no PSG capability", () => {
    const shopUser = principal({ shopIds: [SHOP_A] });
    for (const capability of CAPABILITIES) expect(hasCapability(shopUser, capability)).toBe(false);
  });

  it("grants an admin every capability", () => {
    const admin = principal({ psgRoles: ["psg_admin"] });
    for (const capability of CAPABILITIES) expect(hasCapability(admin, capability)).toBe(true);
  });

  it("keeps publishing and shop setup with admins only", () => {
    const operator = principal({ psgRoles: ["psg_operator"] });
    const reviewer = principal({ psgRoles: ["psg_reviewer"] });
    for (const p of [operator, reviewer]) {
      expect(hasCapability(p, "instrument.manage")).toBe(false);
      expect(hasCapability(p, "shop.manage")).toBe(false);
      expect(hasCapability(p, "user.manage")).toBe(false);
    }
  });

  it("combines capabilities across multiple roles", () => {
    const both = principal({ psgRoles: ["psg_operator", "psg_reviewer"] });
    expect(hasCapability(both, "import.manage")).toBe(true);
    expect(hasCapability(both, "alert.review")).toBe(true);
  });
});
