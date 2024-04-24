// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import moment from "moment";
import { Timing, meta, delay, Identified, Metadata } from "../src/common";
import { countTokens } from "../src/clients/openai";

class TestObject implements Identified {
  metadata: Metadata = {} as Metadata;
}

describe("Common", () => {
  describe("Timing", () => {
    test("Start and end", async () => {
      const timing = new Timing();
      expect(timing.hasEnded).toBe(false);
      await delay(100);
      timing.finish();
      expect(timing.hasEnded).toBe(true);
      expect(timing.elapsed.asMilliseconds()).toBeGreaterThan(90);
      expect(timing.elapsed.asMilliseconds()).toBeLessThan(200);
    });

    test("Start and end with parameters", async () => {
      const start = moment();
      await delay(100);
      const end = moment();
      const timing = new Timing(start, end);
      expect(timing.hasEnded).toBe(true);
      expect(timing.elapsed.asMilliseconds()).toBeGreaterThan(90);
      expect(timing.elapsed.asMilliseconds()).toBeLessThan(200);
    });

    test("Start and end with parameters, end before start", async () => {
      const start = moment();
      await delay(100);
      const end = moment();
      await delay(100);
      expect(() => new Timing(end, start)).toThrow();
    });

    test("Ending with start in the future", async () => {
      const start = moment().add(100, "ms");
      const timing = new Timing(start);
      expect(() => timing.finish()).toThrow();
    });

    test("Elapsed before end", async () => {
      const timing = new Timing();
      expect(timing.hasEnded).toBe(false);
      await delay(100);
      expect(timing.hasEnded).toBe(false);
      expect(timing.elapsed.asMilliseconds()).toBeGreaterThan(90);
      expect(timing.elapsed.asMilliseconds()).toBeLessThan(200);
      timing.finish();
      expect(timing.hasEnded).toBe(true);
    });

    test("Double finish", async () => {
      const timing = new Timing();
      expect(timing.hasEnded).toBe(false);
      await delay(100);
      timing.finish();
      expect(timing.hasEnded).toBe(true);
      expect(() => timing.finish()).toThrow();
    });
  });

  describe("Metadata", () => {
    test("Meta", async () => {
      const metadata = meta(TestObject);
      expect(metadata.ID).toBeDefined();
      expect(metadata.ID).toMatch(/^testobject-.+$/);

      expect(metadata.timing).toBeDefined();
      expect(metadata.timing.hasEnded).toBeFalsy();

      expect(metadata.topic).toBeUndefined();
    });

    test("Meta with topic", async () => {
      const metadata = meta(TestObject, "testy test");
      expect(metadata.topic).toBe("testy test");
    });
  });

  test("Unique IDs", () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = meta(TestObject).ID;
      expect(ids).not.toContain(id);
      ids.push(id);
    }
  });

  test("Token Counting", async () => {
    const text = "Hello, World!";
    const tokens = countTokens(text);
    expect(tokens).toBe(4);
  });
});
