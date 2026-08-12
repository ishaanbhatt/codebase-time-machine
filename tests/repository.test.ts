import { describe, expect, it } from "vitest";

import { canonicalRepositoryKey, parseRepositoryRef } from "@/lib/repository";

describe("parseRepositoryRef", () => {
  it.each([
    ["openai/codex", { owner: "openai", repo: "codex" }],
    ["  OpenAI/Codex  ", { owner: "OpenAI", repo: "Codex" }],
    ["openai/codex.git", { owner: "openai", repo: "codex" }],
    ["https://github.com/openai/codex", { owner: "openai", repo: "codex" }],
    ["https://GITHUB.com/openai/codex/", { owner: "openai", repo: "codex" }],
  ])("parses %s", (input, expected) => {
    expect(parseRepositoryRef(input)).toEqual(expected);
  });

  it.each([
    "",
    "openai",
    "openai/codex/extra",
    "/openai/codex",
    "openai//codex",
    "../codex",
    "openai/..",
    "openai/codex?tab=readme",
    "http://github.com/openai/codex",
    "https://github.example/openai/codex",
    "https://user:secret@github.com/openai/codex",
    "https://github.com/openai/codex?tab=readme",
    "https://github.com/openai/codex#readme",
    "https://github.com/openai/codex/issues",
    "ftp://github.com/openai/codex",
    `${"a".repeat(101)}/repo`,
    `owner/${"r".repeat(101)}`,
  ])("rejects %s", (input) => {
    expect(parseRepositoryRef(input)).toBeNull();
  });

  it("normalizes repository identity without mutating display casing", () => {
    const parsed = parseRepositoryRef("OpenAI/Codex");
    expect(parsed).toEqual({ owner: "OpenAI", repo: "Codex" });
    expect(canonicalRepositoryKey(parsed!)).toBe("openai/codex");
  });
});
