import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register service worker for push notifications (production only, not in iframes)
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if ("serviceWorker" in navigator && !isInIframe && !isPreviewHost) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("SW registration failed:", err);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
