/**
 * Typed domain errors mapped to HTTP by the global exception filter. Stable
 * string codes per docs/05 §0. Never leak Prisma errors or stack traces to
 * clients — throw these instead.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "OUT_OF_SCOPE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_FUNDS"
  | "KYC_REQUIRED"
  | "REGION_BLOCKED"
  | "SELF_EXCLUDED"
  | "RG_LIMIT_EXCEEDED"
  | "IDEMPOTENT_REPLAY"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details?: unknown, message = "Invalid input") {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", 401, message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = "Invalid credentials") {
    super("INVALID_CREDENTIALS", 401, message);
  }
}

export class MfaRequiredError extends AppError {
  constructor(message = "MFA code required") {
    super("MFA_REQUIRED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", 403, message);
  }
}

export class OutOfScopeError extends AppError {
  constructor(message = "Target is outside your subtree") {
    super("OUT_OF_SCOPE", 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("CONFLICT", 409, message);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds", details?: unknown) {
    super("INSUFFICIENT_FUNDS", 409, message, details);
  }
}
