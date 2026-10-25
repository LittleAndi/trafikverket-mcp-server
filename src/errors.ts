/** Error thrown for any failure talking to, or interpreting, the Trafikverket Trafikinfo API. */
export class TrafikverketClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'TrafikverketClientError';
    this.statusCode = statusCode;
  }
}
