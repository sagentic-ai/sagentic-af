// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

export type LogID = number | undefined;

export type LoggerFunction = (...stuff: any[]) => LogID;

export interface LoggerProvider {
  log: LoggerFunction;
  ilog: LoggerFunction;
}
