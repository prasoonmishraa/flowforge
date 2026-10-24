import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

export default defineConfig({
  test: {
    env: dotenv.config({ path: ".env.test" }).parsed,
  },
});
