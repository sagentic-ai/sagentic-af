// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { Ledger, PCT } from "../src/ledger";
import { Session } from "../src/session";
import { BuiltinModel, models, cards } from "../src/models";
import { meta, Timing, delay } from "../src/common";

const expectPCT = (pct: PCT, prompt: number, completion: number) => {
  expect(pct.prompt).toBe(prompt);
  expect(pct.completion).toBe(completion);
  expect(pct.total).toBeCloseTo(prompt + completion);
};

const mockSession = () => {
  return {
    metadata: meta(Session, "ledger test"),
  } as unknown as Session;
};

describe("PCT", () => {
  test("Empty PCT", () => {
    const pct = new PCT();
    expect(pct.prompt).toBe(0);
    expect(pct.completion).toBe(0);
    expect(pct.total).toBe(0);
  });

  test("PCT with data", () => {
    const prompt = 100;
    const completion = 200;
    const pct = new PCT({ prompt, completion });
    expect(pct.prompt).toBe(prompt);
    expect(pct.completion).toBe(completion);
    expect(pct.total).toBe(prompt + completion);
  });

  test("Add PCT", () => {
    const a = new PCT({ prompt: 100, completion: 200 });
    const b = new PCT({ prompt: 300, completion: 400 });
    const c = a.add(b);
    expectPCT(a, 400, 600);
    expectPCT(b, 300, 400);
    expectPCT(c, 400, 600);
  });
});

describe("Ledger", () => {
  let ledger: Ledger;

  const a = 100;
  const b = 200;

  beforeAll(() => {
    ledger = new Ledger(mockSession());
  });

  test("Empty Ledger", () => {
    expect(ledger).toBeDefined();
    expect(ledger.timespan.asMilliseconds()).toBe(0);
    expect(ledger.len).toBe(0);
    expect(ledger.cost).toBeDefined();
    expect(ledger.tokens).toBeDefined();

    expectPCT(ledger.cost, 0, 0);
    expectPCT(ledger.tokens, 0, 0);
  });

  test("Single Entry", async () => {
    const timing = new Timing();
    await delay(100);
    timing.finish();

    ledger.add(
      "test",
      models[BuiltinModel.GPT35Turbo],
      timing,
      new PCT({ prompt: a, completion: b })
    );

    expect(ledger.len).toBe(1);
    expectPCT(ledger.tokens, a, b);
    expectPCT(
      ledger.cost,
      cards[BuiltinModel.GPT35Turbo].prompt * (a / 1000000.0),
      cards[BuiltinModel.GPT35Turbo].completion * (b / 1000000.0)
    );

    expectPCT(ledger.modelTokens[BuiltinModel.GPT35Turbo], a, b);
    expectPCT(
      ledger.modelCost[BuiltinModel.GPT35Turbo],
      cards[BuiltinModel.GPT35Turbo].prompt * (a / 1000000.0),
      cards[BuiltinModel.GPT35Turbo].completion * (b / 1000000.0)
    );
  });

  test("Multiple Entries", async () => {
    const timing = new Timing();
    await delay(100);
    timing.finish();

    ledger.add(
      "test",
      models[BuiltinModel.GPT4],
      timing,
      new PCT({ prompt: a, completion: b })
    );

    expect(ledger.len).toBe(2);
    expectPCT(ledger.tokens, 2 * a, 2 * b);
    expectPCT(
      ledger.cost,
      (cards[BuiltinModel.GPT35Turbo].prompt * a) / 1000000.0 +
        (cards[BuiltinModel.GPT4].prompt * a) / 1000000.0,
      (cards[BuiltinModel.GPT35Turbo].completion * b) / 1000000.0 +
        (cards[BuiltinModel.GPT4].completion * b) / 1000000.0
    );
    expectPCT(ledger.modelTokens[BuiltinModel.GPT35Turbo], a, b);
    expectPCT(
      ledger.modelCost[BuiltinModel.GPT35Turbo],
      cards[BuiltinModel.GPT35Turbo].prompt * (a / 1000000.0),
      cards[BuiltinModel.GPT35Turbo].completion * (b / 1000000.0)
    );
    expectPCT(ledger.modelTokens[BuiltinModel.GPT4], a, b);
    expectPCT(
      ledger.modelCost[BuiltinModel.GPT4],
      cards[BuiltinModel.GPT4].prompt * (a / 1000000.0),
      cards[BuiltinModel.GPT4].completion * (b / 1000000.0)
    );

    expectPCT(
      ledger.callerCost["test"],
      ledger.cost.prompt,
      ledger.cost.completion
    );
    expectPCT(
      ledger.callerTokens["test"],
      ledger.tokens.prompt,
      ledger.tokens.completion
    );

    expect(ledger.timespan.asMilliseconds()).toBeGreaterThanOrEqual(200);
  });

  test("Add with unclosed timing", async () => {
    const timing = new Timing();
    await delay(100);
    const entries = ledger.len;
    expect(() =>
      ledger.add(
        "test",
        models[BuiltinModel.GPT4],
        timing,
        new PCT({ prompt: a, completion: b })
      )
    ).toThrow();
    expect(ledger.len).toBe(entries);
  });
});
