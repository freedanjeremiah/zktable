/** An error with an HTTP status attached, thrown by the orchestrator and
 *  translated 1:1 into a JSON error response by the API routes. */
export class BlackoutApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BlackoutApiError";
    this.status = status;
  }
}
