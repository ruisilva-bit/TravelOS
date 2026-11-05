import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const forms = [...html.matchAll(/<form\b[^>]*>/giu)].map(([form]) => form);

describe("Portal static entry", () => {
  it("provides a Portal login before JavaScript with POST semantics and no credential URL", () => {
    expect(html).toMatch(/<html[^>]*\blang="pt-PT"/iu);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatch(/\bmethod="post"/iu);
    expect(forms[0]).toMatch(/\baction="\/api\/auth\/portal\/sign-in\/email"/iu);
    expect(forms[0]).not.toMatch(/\bmethod="get"/iu);
    expect(html).toMatch(/name="email"[^>]*autocomplete="username"/iu);
    expect(html).toMatch(/name="password"[^>]*autocomplete="current-password"/iu);
    expect(html).not.toMatch(/<input[^>]*\btype="password"[^>]*\bvalue=/iu);
    expect(html).not.toMatch(/action="[^"]*\?/iu);
  });
});
