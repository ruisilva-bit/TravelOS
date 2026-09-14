import "@travelos/design-system/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PortalRoot } from "./app.js";

const rootElement = document.getElementById("portal-root");

if (rootElement === null) {
  throw new Error("portal-root element is required");
}

createRoot(rootElement).render(
  <StrictMode>
    <PortalRoot />
  </StrictMode>,
);
