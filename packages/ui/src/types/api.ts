/**
 * Matches the server's error handler output shape (see error-handler.ts).
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
  fields?: Record<string, string>;
}

/**
 * Standard paginated response from admin API endpoints.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
