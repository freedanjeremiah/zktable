/** HTTP-status-carrying error for the Liar's Dice web API (mirrors BlackoutApiError). */
export class LiarsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LiarsApiError";
  }
}
