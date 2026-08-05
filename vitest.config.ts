import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deno-only specifier used by the edge-function router.
      "npm:@supabase/supabase-js@2/cors": path.resolve(__dirname, "./src/test/stubs/deno-cors.ts"),
    },
  },
});
