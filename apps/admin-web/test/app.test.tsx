// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminRoot } from "../src/app.js";

describe("Admin Web foundation", () => {
  it("has its own Admin routing root and minimal content", () => {
    const view = render(<AdminRoot />);
    expect(screen.getByRole("heading", { name: "TravelOS" })).toBeInTheDocument();
    expect(screen.getByText("Development Foundation")).toBeInTheDocument();
    expect(view.container.querySelector('[data-routing-root="admin"]')).toBeInTheDocument();
  });
});
