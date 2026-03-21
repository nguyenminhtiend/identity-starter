export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} with id '${id}' not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends DomainError {
  constructor(entity: string, field: string, value: string) {
    super('CONFLICT', `${entity} with ${field} '${value}' already exists`);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends DomainError {
  public readonly fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}
