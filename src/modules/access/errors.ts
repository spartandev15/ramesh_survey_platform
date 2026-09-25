/**
 * Authorization failures. `NotFoundError` is used for another tenant's data so
 * responses never reveal whether a record exists (PDF: 404 without tenant enumeration).
 */
export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

export type AccessError = UnauthenticatedError | ForbiddenError | NotFoundError;

export function isAccessError(e: unknown): e is AccessError {
  return e instanceof UnauthenticatedError || e instanceof ForbiddenError || e instanceof NotFoundError;
}
