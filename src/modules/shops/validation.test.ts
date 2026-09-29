import { describe, expect, it } from "vitest";
import { shopInputSchema } from "./validation";
import { slugify } from "./fields";

describe("slugify", () => {
  it("builds a readable public link name", () => {
    expect(slugify("Joe's Body Shop")).toBe("joes-body-shop");
    expect(slugify("  Élite  Collision -- Center ")).toBe("elite-collision-center");
  });
});

describe("shopInputSchema", () => {
  const valid = { name: "Joe's Body Shop", publicSlug: "joes-body-shop", timezone: "America/Chicago", isTestShop: false };

  it("accepts a valid shop", () => {
    expect(shopInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects slugs that are not URL-safe", () => {
    for (const publicSlug of ["Joe Shop", "-joe", "joe--shop", "jo", "joe/shop"]) {
      expect(shopInputSchema.safeParse({ ...valid, publicSlug }).success, publicSlug).toBe(false);
    }
  });

  it("normalizes slug case", () => {
    const parsed = shopInputSchema.parse({ ...valid, publicSlug: "Joes-Body-Shop" });
    expect(parsed.publicSlug).toBe("joes-body-shop");
  });
});
