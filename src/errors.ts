/**
 * Custom error types for @mesahub/client
 */

export class SqliteHubError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SqliteHubError';
  }

  static fromResponse(response: Response, body: any): SqliteHubError {
    const code = body?.code || 'UNKNOWN_ERROR';
    const message = body?.message || response.statusText;
    return new SqliteHubError(code, response.status, message, body);
  }
}

export class AuthenticationError extends SqliteHubError {
  constructor(message = 'Authentication failed') {
    super('AUTH_ERROR', 401, message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends SqliteHubError {
  constructor(message = 'Insufficient permissions') {
    super('AUTHZ_ERROR', 403, message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends SqliteHubError {
  constructor(resource: string) {
    super('NOT_FOUND', 404, `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends SqliteHubError {
  constructor(retryAfter?: number) {
    super('RATE_LIMIT', 429, 'Rate limit exceeded', { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends SqliteHubError {
  constructor(message = 'Validation failed', details?: Record<string, any>) {
    super('VALIDATION_ERROR', 400, message, details);
    this.name = 'ValidationError';
  }
}
