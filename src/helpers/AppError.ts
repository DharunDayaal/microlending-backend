export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly type?: string;

  constructor(statusCode: number, message: string, isOperational = true, type?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.type = type;
  }
}
