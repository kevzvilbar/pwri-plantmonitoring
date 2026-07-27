import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { supabaseConfigError } from "@/integrations/supabase/client";
import "./index.css";

// ── Chunk-load failure handler ────────────────────────────────────────────────
// When GitHub Pages deploys a new build, Vite generates new chunk filenames
// (e.g. Operations-BIBkQB0q.js → Operations-XYZ123.js). If a user's browser
// has cached the old index.html, React.lazy() tries to fetch the old filename
// → 404 → unhandled promise rejection → white screen.
//
// This listener intercepts that rejection BEFORE the ErrorBoundary and does a
// hard reload (which fetches the new index.html and the correct chunks).
// A sessionStorage flag prevents an infinite reload loop if the chunk is
// genuinely missing for another reason.

const CHUNK_RELOAD_FLAG = 'pwri_chunk_reload_attempted';

function isChunkError(reason: unknown): boolean {
  const msg = (reason as Error)?.message ?? String(reason ?? '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading') ||
    msg.includes('dynamically imported module')
  );
}

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  if (!isChunkError(event.reason)) return;

  const alreadyTried = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1';
  if (alreadyTried) return; // Let the ErrorBoundary show the message instead.

  event.preventDefault(); // Stop the browser console error.
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  window.location.reload();
});

// Clear the chunk-reload flag on a successful load so future navigations
// get a fresh attempt if needed.
window.addEventListener('load', () => {
  sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
});

// ── App bootstrap ─────────────────────────────────────────────────────────────
const rootEl = document.getElementById("root");

function renderFatal(message: string, detail?: string) {
  if (!rootEl) return;
  rootEl.textContent = "";

  const wrap = document.createElement("div");
  wrap.setAttribute(
    "style",
    "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#fff;color:#111;",
  );

  const inner = document.createElement("div");
  inner.setAttribute("style", "max-width:640px;text-align:left;");

  const heading = document.createElement("h1");
  heading.setAttribute("style", "font-size:20px;margin:0 0 12px;");
  heading.textContent = "App failed to load";
  inner.appendChild(heading);

  const para = document.createElement("p");
  para.setAttribute("style", "margin:0 0 12px;line-height:1.5;");
  para.textContent = message;
  inner.appendChild(para);

  if (detail) {
    const pre = document.createElement("pre");
    pre.setAttribute(
      "style",
      "white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px;overflow:auto;",
    );
    pre.textContent = detail;
    inner.appendChild(pre);
  }

  wrap.appendChild(inner);
  rootEl.appendChild(wrap);
}

try {
  if (supabaseConfigError) {
    renderFatal(supabaseConfigError);
  } else if (rootEl) {
    createRoot(rootEl).render(<App />);
  }
} catch (err) {
  const e = err as Error;
  renderFatal(
    "An unexpected error occurred while starting the app.",
    `${e?.name ?? ""}: ${e?.message ?? String(err)}\n\n${e?.stack ?? ""}`,
  );
  console.error("[main] render error", err);
}
