// pattern: Functional Core

export type ShellConfig = {
  readonly shell: string;
  readonly commandTimeout: number;
  readonly idleTimeout: number;
  readonly maxOutputBytes: number;
  readonly promptMarker: string;
};

export type ShellResult = {
  readonly output: string;
  readonly exitCode: number | null;
  readonly workingDirectory: string;
  readonly timedOut: boolean;
};

export type ShellSession = {
  execute(command: string): Promise<ShellResult>;
  destroy(): Promise<void>;
  readonly isAlive: boolean;
  readonly workingDirectory: string;
};
