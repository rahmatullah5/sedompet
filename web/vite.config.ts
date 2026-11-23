import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Serves api/market.ts during `vite dev` (on Vercel it's an edge function). */
function devApi(): Plugin {
  return {
    name: "sedompet-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/market", async (req, res) => {
        try {
          const mod = await server.ssrLoadModule("/api/market.ts");
          const r: Response = await mod.default(new Request(`http://localhost${req.originalUrl ?? req.url}`));
          res.statusCode = r.status;
          res.setHeader("Content-Type", r.headers.get("Content-Type") ?? "application/json");
          res.end(await r.text());
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  // Absolute asset paths: the app is served at /, /app and /demo.
  base: "/",
});
