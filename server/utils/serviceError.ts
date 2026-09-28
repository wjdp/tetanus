// Services throw these so routes can surface a status code without importing
// H3 into the domain layer.
export class ServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function notFound(message: string) {
  return new ServiceError(404, message);
}

export function invalidRequest(message: string) {
  return new ServiceError(400, message);
}
