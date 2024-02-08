export type LogID = number | undefined;

export type LoggerFunction = (...stuff: any[]) => LogID;

export interface LoggerProvider {
  log: LoggerFunction;
  ilog: LoggerFunction;
}
