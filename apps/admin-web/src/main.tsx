import "@travelos/design-system/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AdminRoot } from "./app.js";

const rootElement = document.getElementById("admin-root");

if (rootElement === null) {
  throw new Error("admin-root element is required");
}

createRoot(rootElement).render(
  <StrictMode>
    <AdminRoot />
  </StrictMode>,
);
