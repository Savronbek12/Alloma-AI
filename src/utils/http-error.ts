export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, details);
  }

  static notFound(message = "Topilmadi"): HttpError {
    return new HttpError(404, message);
  }
}
