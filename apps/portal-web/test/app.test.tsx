// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PortalRoot } from "../src/app.js";

describe("Portal Web foundation", () => {
  it("has its own Portal routing root and minimal content", () => {
    const view = render(<PortalRoot />);
    expect(screen.getByRole("heading", { name: "TravelOS Portal" })).toBeInTheDocument();
    expect(screen.getByText("Development Foundation")).toBeInTheDocument();
    expect(view.container.querySelector('[data-routing-root="portal"]')).toBeInTheDocument();
  });
});
