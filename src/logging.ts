// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

export type LogID = number | undefined;

export type LoggerFunction = (...stuff: any[]) => LogID;

export interface LoggerProvider {
  log: LoggerFunction;
  ilog: LoggerFunction;
}
