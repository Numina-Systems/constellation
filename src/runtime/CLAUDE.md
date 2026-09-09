# Runtime

Last verified: 2026-09-09

## Purpose

Executes agent-generated TypeScript in a Deno subprocess with bounded lifetime, raw byte streams, IPC frames, tool admission, and controlled permissions.

## Contracts

- **Exposes**: `CodeRuntime`, `ExecutionContext`, `ExecutionResult`, `createDenoExecutor`, runtime process seams, credential/secret constant generation, and IPC types.
- **Guarantees**:
  - Defaults are `max_code_size=51200` bytes, `max_output_size=1048576` decoded output bytes, `code_timeout=60000` ms, and `max_tool_calls_per_exec=25`.
  - Raw stream defaults are `max_stdout_bytes=4194304`, `max_stderr_bytes=65536`, and `max_ipc_frame_bytes=1048576`. Raw stdout includes protocol traffic; limits are counted before UTF-8 decoding or concatenation.
  - Unterminated/oversized frames, malformed nonempty IPC, protocol overflow, timeout, and cancellation close one execution-local `OPEN -> CLOSING -> CLOSED` lifecycle. No queued host call starts after closure.
  - Already-started uncancellable calls are reported as `outcome_unknown` with unresolved call IDs. The runtime does not roll them back or retry them automatically.
  - Diagnostics are bounded to 2,000 bytes and cleanup waits at most 100 ms after closure.
  - Granular Deno permissions use configured host/path/subprocess allowlists. `unrestricted=true` removes those allowlists but does not remove host-side resource limits.
  - Temporary scripts are cleaned up after execution.
- **Expects**: Deno on `PATH`, an existing `working_dir`, and a populated `ToolRegistry`.

## Dependencies

- **Uses**: `src/tool/` for registry dispatch, `src/config/`, and execution contracts.
- **Used by**: agent `execute_code` dispatch and custom-tool handlers.
- **Boundary**: `src/runtime/deno/runtime.ts` runs under Deno and is outside the normal Bun type-check boundary.

## IPC Protocol

Newline-delimited JSON uses `__output__`, `__tool_call__`, and `__debug__` from Deno to the host, and `__tool_result__`/`__tool_error__` from host to Deno. The host owns admission and resource enforcement.

## Key Files

- `types.ts` -- runtime port, execution options, results, and IPC messages.
- `policy.ts` -- pure lifecycle/frame/byte policy.
- `executor.ts` -- subprocess orchestration and bounded cleanup.
- `deno/runtime.ts` -- Deno-side IPC bridge.
