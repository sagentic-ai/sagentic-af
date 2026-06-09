// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { BuiltinModel, cards, models } from "../src/models";

describe("GPT-5.5 Model Definitions", () => {
  test("GPT-5.5 enum value exists", () => {
    expect(BuiltinModel.GPT55).toBe("gpt-5.5");
  });

  test("GPT-5.5 card matches documented limits", () => {
    expect(cards[BuiltinModel.GPT55].checkpoint).toBe("gpt-5.5-2026-04-23");
    expect(cards[BuiltinModel.GPT55].prompt).toBe(5);
    expect(cards[BuiltinModel.GPT55].completion).toBe(30);
    expect(cards[BuiltinModel.GPT55].contextSize).toBe(1_050_000);
    expect(cards[BuiltinModel.GPT55].maxOutputTokens).toBe(128_000);
    expect(cards[BuiltinModel.GPT55].knowledgeCutoff).toBe("2025-12-01");
    expect(cards[BuiltinModel.GPT55].batchQueueLimit).toBe(15_000_000_000);
  });

  test("GPT-5.5 supports documented capabilities", () => {
    expect(cards[BuiltinModel.GPT55].supportsImages).toBe(true);
    expect(cards[BuiltinModel.GPT55].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.GPT55].defaultReasoningEffort).toBe("medium");
    expect(models[BuiltinModel.GPT55]).toBeDefined();
  });
});
