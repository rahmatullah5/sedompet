import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initDatabase } from "./db/database";
import { getMode, getRoute, supabase } from "./cloud/client";
import { Landing } from "./pages/Landing";

const root = createRoot(document.getElementById("root")!);

// Old invite links (/?kode=…) belong to the app.
if (getRoute() === "landing" && new URLSearchParams(location.search).has("kode")) {
  location.replace("/app" + location.search);
}

const mode = getMode();

if (getRoute() === "landing") {
  root.render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
} else initDatabase(mode)
  .then(async () => {
    if (mode === "cloud" && supabase) {
      const { startCloudSync } = await import("./cloud/sync");
      // Render immediately; the app shows a loading screen until sync is ready.
      void startCloudSync();
    }
  })
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((e) => {
    console.error(e);
    root.render(
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Sedompet tidak bisa dimuat</h1>
        <p>Browser ini tidak mendukung database lokal (WebAssembly / IndexedDB). Coba Chrome, Edge, Firefox atau Safari terbaru.</p>
        <pre>{String(e)}</pre>
      </div>,
    );
  });
