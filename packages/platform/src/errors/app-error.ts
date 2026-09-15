export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toEnvelope(requestId?: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        details: this.details,
      },
    };
  }

  public static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, 400, details);
  }

  public static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', message, 401);
  }

  public static forbidden(message = 'Access denied'): AppError {
    return new AppError('FORBIDDEN', message, 403);
  }

  public static notFound(resource: string, id?: string): AppError {
    const msg = id ? `${resource} with id '${id}' was not found` : `${resource} was not found`;
    return new AppError('NOT_FOUND', msg, 404);
  }

  public static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, 409, details);
  }

  public static unprocessable(message: string, details?: unknown): AppError {
    return new AppError('UNPROCESSABLE_ENTITY', message, 422, details);
  }

  public static rateLimited(message = 'Rate limit exceeded'): AppError {
    return new AppError('RATE_LIMITED', message, 429);
  }

  public static circuitOpen(message = 'Circuit breaker is open'): AppError {
    return new AppError('CIRCUIT_OPEN', message, 503);
  }

  public static timeout(message = 'Operation timed out'): AppError {
    return new AppError('TIMEOUT', message, 504);
  }

  public static internal(message = 'Internal server error', details?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', message, 500, details);
  }
}
