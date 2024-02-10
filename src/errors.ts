// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import { Identified, Metadata } from "./common";

class AssertionError extends Error {
  origin?: Metadata;
  extra?: Metadata;
  constructor(origin: Identified, message?: string, extra?: Identified) {
    super(message || "Assertion failed");
    this.origin = origin.metadata;
    this.extra = extra?.metadata;
  }
}

/**
 * Asserts that a condition is true, otherwise throws an AssertionError.
 * @param origin The origin object of the assertion.
 * @param condition The condition to assert.
 * @param message An optional message to include in the error.
 * @param source An optional source of the assertion.
 * @throws AssertionError if the condition is false.
 */
export const assert = (
  origin: Identified,
  condition: boolean,
  message?: string,
  source?: Identified
): void => {
  if (!condition) {
    throw new AssertionError(origin, message, source);
  }
};
