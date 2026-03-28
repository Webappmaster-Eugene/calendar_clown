import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

function showFatalError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;

  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML =
    '<div style="padding:24px;font-family:system-ui,sans-serif;text-align:center">' +
    '<p style="font-size:48px;margin-bottom:12px">😵</p>' +
    '<p style="margin-bottom:16px;color:#b71c1c">Ошибка загрузки приложения</p>' +
    '<pre style="text-align:left;font-size:12px;background:#f5f5f5;padding:12px;border-radius:8px;overflow:auto;max-height:200px">' +
    message.replace(/</g, "&lt;") +
    "</pre>" +
    '<button onclick="location.reload()" style="margin-top:16px;padding:10px 18px;border:none;border-radius:10px;background:#2481cc;color:#fff;font-size:15px;cursor:pointer">' +
    "Перезагрузить</button></div>";
}

window.onerror = (_msg, _src, _line, _col, error) => {
  console.error("[global onerror]", error);
};

window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  console.error("[unhandledrejection]", event.reason);
};

try {
  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} catch (error) {
  console.error("Failed to mount React app:", error);
  showFatalError(error);
}
