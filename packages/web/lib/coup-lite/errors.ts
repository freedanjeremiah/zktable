/** HTTP-status-carrying error for the Coup-lite web API. */
export class CoupApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoupApiError";
  }
}
