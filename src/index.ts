/**
 * @mesahub/client
 * TypeScript SDK for MesaHub
 */

export { MesahubClient, parseMesahubUrl } from './client.js';
export { MesahubError, AuthenticationError, AuthorizationError, NotFoundError, RateLimitError, ValidationError } from './errors.js';
export { DatabaseHandle } from './database.js';
export { TableHandle } from './table.js';

export type { MesahubClientConfig, ParsedMesahubUrl } from './client.js';
export type {
  QueryResult,
  ExecResult,
  FileRecord,
  // High-level table API types
  WhereOperator,
  WhereClause,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  CountOptions,
  InsertManyOptions,
} from './types.js';
export type { StreamResponse } from '@pingpong-js/fetch';
