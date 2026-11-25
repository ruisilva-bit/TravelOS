import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  structuredClone: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      ".git/**",
      ".hermes/**",
      "docs/**",
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "deploy/manifests/schema/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        exports: "readonly",
        module: "readonly",
      },
    },
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      globals: nodeGlobals,
    },
    plugins: { boundaries },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
