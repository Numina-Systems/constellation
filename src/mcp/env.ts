// pattern: Functional Core

import type { McpServerConfig } from './schema.ts';

/**
 * Resolves ${VAR_NAME} patterns in a string using values from env.
 * If a variable is not found in env, the ${VAR_NAME} literal is left as-is.
 */
export function resolveEnvVars(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const resolved = env[varName];
    return resolved !== undefined ? resolved : match;
  });
}

/**
 * Recursively resolves env vars in an McpServerConfig.
 * For stdio configs: resolves command, each args item, and each env value.
 * For http configs: resolves url.
 */
export function resolveServerConfigEnv(
  config: McpServerConfig,
  env: Readonly<Record<string, string | undefined>>,
): McpServerConfig {
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: resolveEnvVars(config.command, env),
      args: config.args.map((arg) => resolveEnvVars(arg, env)),
      env: Object.fromEntries(
        Object.entries(config.env).map(([key, value]) => [
          key,
          resolveEnvVars(value, env),
        ]),
      ),
    };
  }

  if (config.transport === 'http') {
    return {
      transport: 'http',
      url: resolveEnvVars(config.url, env),
    };
  }

  // Exhaustiveness check: if we reach here, there's an unknown transport type
  const _exhaustive: never = config;
  return _exhaustive;
}
