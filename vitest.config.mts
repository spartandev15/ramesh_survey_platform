import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server modules import "server-only"; tests run them directly on the server side.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
    // Lets modules that import "server-only" load in tests.
    conditions: ["react-server"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests trigger failures on purpose (bridge errors, stuck queues); keep their log lines out of the test output.
    env: { LOG_LEVEL: "error" },
  },
});
