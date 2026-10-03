export type TrpcErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "INTERNAL_SERVER_ERROR"
  | "NOT_FOUND"
  | "TOO_MANY_REQUESTS";

export type AppErrorLogLevel = "error" | "warn" | "info";

type AppErrorDefinition = {
  /** Dictionary key, added to the en/ar dictionaries by the step that first shows it. */
  i18nKey: string;
  trpcCode: TrpcErrorCode;
  logLevel: AppErrorLogLevel;
};

export const APP_ERRORS = {
  internal: {
    i18nKey: "errors.internal",
    trpcCode: "INTERNAL_SERVER_ERROR",
    logLevel: "error",
  },
  not_found: {
    i18nKey: "errors.notFound",
    trpcCode: "NOT_FOUND",
    logLevel: "info",
  },
  forbidden: {
    i18nKey: "errors.forbidden",
    trpcCode: "FORBIDDEN",
    logLevel: "warn",
  },
  rate_limited: {
    i18nKey: "errors.rateLimited",
    trpcCode: "TOO_MANY_REQUESTS",
    logLevel: "warn",
  },
  invalid_input: {
    i18nKey: "errors.invalidInput",
    trpcCode: "BAD_REQUEST",
    logLevel: "info",
  },
} as const satisfies Record<string, AppErrorDefinition>;

export type AppErrorCode = keyof typeof APP_ERRORS;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly i18nKey: string;
  readonly trpcCode: TrpcErrorCode;
  readonly logLevel: AppErrorLogLevel;

  constructor(
    code: AppErrorCode,
    options?: { cause?: unknown; message?: string; i18nKey?: string },
  ) {
    super(
      options?.message ?? code,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "AppError";
    this.code = code;
    const def: AppErrorDefinition = APP_ERRORS[code];
    this.i18nKey = options?.i18nKey ?? def.i18nKey;
    this.trpcCode = def.trpcCode;
    this.logLevel = def.logLevel;
  }
}
