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

// Deliberately inline styles + raw DOM, no Tailwind classes or React
// components: this has to render even when the build's CSS never loaded,
// env vars are missing, or React itself threw before mounting. It used to
// be plain black-on-white system text — a jarring drop from the polished
// login screen right below it in the same deploy. Colors are hand-written
// hex here (not the app's HSL custom properties) for the same reason:
// index.css may not have loaded when this path runs.
function renderFatal(message: string, detail?: string) {
  if (!rootEl) return;
  rootEl.textContent = "";

  const wrap = document.createElement("div");
  wrap.setAttribute(
    "style",
    "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;" +
      "font-family:system-ui,-apple-system,sans-serif;" +
      "background:linear-gradient(135deg, #0c1e30 0%, #0d3d38 100%);color:#eef2f6;",
  );

  const inner = document.createElement("div");
  inner.setAttribute(
    "style",
    "max-width:520px;width:100%;text-align:left;background:rgba(255,255,255,0.06);" +
      "border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px;",
  );

  const iconWrap = document.createElement("div");
  iconWrap.setAttribute(
    "style",
    "width:44px;height:44px;border-radius:10px;margin-bottom:16px;display:flex;" +
      "align-items:center;justify-content:center;" +
      "background:linear-gradient(135deg, #14b8a6 0%, #22d3ee 100%);",
  );
  // Inline SVG (no external asset — a missing config is exactly the moment
  // a network-loaded logo can't be trusted to load either).
  iconWrap.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0c1e30" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 8v5"/><circle cx="12" cy="16.3" r="0.4" fill="#0c1e30"/>' +
    '<path d="M10.6 3.5 2.9 18a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 3.5a1.6 1.6 0 0 0-2.8 0Z"/>' +
    "</svg>";
  inner.appendChild(iconWrap);

  const heading = document.createElement("h1");
  heading.setAttribute("style", "font-size:19px;font-weight:700;margin:0 0 10px;letter-spacing:-0.01em;");
  heading.textContent = "PWRI Monitoring couldn't start";
  inner.appendChild(heading);

  const para = document.createElement("p");
  para.setAttribute("style", "margin:0 0 12px;line-height:1.55;font-size:14px;color:#c3ced9;");
  para.textContent = message;
  inner.appendChild(para);

  if (detail) {
    const pre = document.createElement("pre");
    pre.setAttribute(
      "style",
      "white-space:pre-wrap;background:rgba(0,0,0,0.25);color:#c3ced9;padding:12px;" +
        "border-radius:8px;font-size:12px;overflow:auto;border:1px solid rgba(255,255,255,0.08);",
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
