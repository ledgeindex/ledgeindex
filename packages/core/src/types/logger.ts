export type Logger = {
  info(message: string, context?: string, meta?: Record<string, unknown>): void;
  verbose(message: string, context?: string, meta?: Record<string, unknown>): void;
  warn(message: string, context?: string, meta?: Record<string, unknown>): void;
  error(error: Error | string, context?: string, meta?: Record<string, unknown>): void;
};

export const noopLogger: Logger = {
  info() {},
  verbose() {},
  warn() {},
  error() {},
};
