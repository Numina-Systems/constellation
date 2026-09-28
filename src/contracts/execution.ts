import type {ToolOutcome} from './outcomes.ts';

export type RequestBudget = {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxBytes: number;
  readonly maxToolCalls: number;
};

export type ExecutionOptions = {
  readonly signal?: AbortSignal;
  /** Absolute epoch-millisecond deadline. */
  readonly deadline?: number;
  readonly budget?: Readonly<RequestBudget>;
};

export type ToolExchangeCall = {
  readonly callId: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
};

export type ToolExchangeResult = {
  readonly callId: string;
  readonly outcome: ToolOutcome;
};

export type ToolExchange = {
  readonly exchangeId: string;
  readonly calls: ReadonlyArray<ToolExchangeCall>;
  readonly results: ReadonlyArray<ToolExchangeResult>;
};
