// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { BuiltinModel, cards, models } from "../src/models";

describe("GPT-5.4 Model Definitions", () => {
  test("GPT-5.4 enum value exists", () => {
    expect(BuiltinModel.GPT54).toBe("gpt-5.4");
  });

  test("GPT-5.4 card matches documented limits", () => {
    expect(cards[BuiltinModel.GPT54].checkpoint).toBe("gpt-5.4-2026-03-05");
    expect(cards[BuiltinModel.GPT54].prompt).toBe(2.5);
    expect(cards[BuiltinModel.GPT54].completion).toBe(15);
    expect(cards[BuiltinModel.GPT54].contextSize).toBe(1_050_000);
    expect(cards[BuiltinModel.GPT54].maxOutputTokens).toBe(128_000);
    expect(cards[BuiltinModel.GPT54].knowledgeCutoff).toBe("2025-08-31");
    expect(cards[BuiltinModel.GPT54].batchQueueLimit).toBe(15_000_000_000);
  });

  test("GPT-5.4 supports documented capabilities", () => {
    expect(cards[BuiltinModel.GPT54].supportsImages).toBe(true);
    expect(cards[BuiltinModel.GPT54].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.GPT54].defaultReasoningEffort).toBe("none");
    expect(models[BuiltinModel.GPT54]).toBeDefined();
  });
});

describe("GPT-5.3 Codex Model Definitions", () => {
  test("GPT-5.3 Codex enum value exists", () => {
    expect(BuiltinModel.GPT53Codex).toBe("gpt-5.3-codex");
  });

  test("GPT-5.3 Codex card matches documented limits", () => {
    expect(cards[BuiltinModel.GPT53Codex].checkpoint).toBe("gpt-5.3-codex");
    expect(cards[BuiltinModel.GPT53Codex].prompt).toBe(1.75);
    expect(cards[BuiltinModel.GPT53Codex].completion).toBe(14);
    expect(cards[BuiltinModel.GPT53Codex].contextSize).toBe(400_000);
    expect(cards[BuiltinModel.GPT53Codex].maxOutputTokens).toBe(128_000);
    expect(cards[BuiltinModel.GPT53Codex].knowledgeCutoff).toBe("2025-08-31");
    expect(cards[BuiltinModel.GPT53Codex].batchQueueLimit).toBe(
      15_000_000_000
    );
  });

  test("GPT-5.3 Codex supports documented capabilities", () => {
    expect(cards[BuiltinModel.GPT53Codex].supportsImages).toBe(true);
    expect(cards[BuiltinModel.GPT53Codex].supportsReasoning).toBe(true);
    expect(models[BuiltinModel.GPT53Codex]).toBeDefined();
  });
});
