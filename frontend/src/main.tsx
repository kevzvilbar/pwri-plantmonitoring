import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { supabaseConfigError } from "@/integrations/supabase/client";
import "./index.css";

const rootEl = document.getElementById("root");

function renderFatal(message: string, detail?: string) {
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#fff;color:#111;">
      <div style="max-width:640px;text-align:left;">
        <h1 style="font-size:20px;margin:0 0 12px;">App failed to load</h1>
        <p style="margin:0 0 12px;line-height:1.5;">${message}</p>
        ${detail ? `<pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${detail}</pre>` : ""}
      </div>
    </div>`;
}

try {
  if (supabaseConfigError) {
    renderFatal(supabaseConfigError);
  } else if (rootEl) {
    createRoot(rootEl).render(<App />);
  }
} catch (err) {
  const e = err as Error;
  renderFatal("An unexpected error occurred while starting the app.", `${e?.name ?? ""}: ${e?.message ?? String(err)}\n\n${e?.stack ?? ""}`);
  // eslint-disable-next-line no-console
  console.error("[main] render error", err);
}
