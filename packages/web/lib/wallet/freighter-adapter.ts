/**
 * Thin adapter over `@stellar/freighter-api`.
 *
 * Freighter's raw functions never reject a promise — they resolve to
 * `{ ...payload, error?: FreighterApiError }`. That shape is easy to forget
 * to check. This module normalizes it: every export here either resolves
 * with real data or throws a `FreighterAdapterError` with a message written
 * for a player, not a debugger.
 *
 * Testnet only — this app never touches mainnet.
 */
import {
  getAddress as freighterGetAddress,
  getNetworkDetails as freighterGetNetworkDetails,
  isAllowed as freighterIsAllowed,
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
} from "@stellar/freighter-api";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

export class FreighterAdapterError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FreighterAdapterError";
  }
}

export interface NetworkInfo {
  network: string;
  networkPassphrase: string;
  networkUrl: string;
  sorobanRpcUrl?: string;
}

/**
 * Freighter talks to the page via `window.postMessage`. A couple of its own
 * calls (`isConnected`, `getAddress`) resolve on a built-in 2s timeout when
 * nothing answers, but others (`isAllowed`, `getNetworkDetails`, and
 * critically `requestAccess`) do not — with no extension installed, those
 * would hang forever with no way for the UI to say so. Every call in this
 * adapter gets its own timeout so "not installed" always surfaces as a
 * friendly error instead of an infinite spinner.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new FreighterAdapterError(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const NOT_RESPONDING_MESSAGE =
  "Freighter didn't respond. Make sure the extension is installed and unlocked.";

/** Is the Freighter browser extension installed and responding at all? */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const res = await withTimeout(
      freighterIsConnected(),
      3000,
      NOT_RESPONDING_MESSAGE,
    );
    if (res.error) return false;
    return res.isConnected;
  } catch {
    return false;
  }
}

/** Has this origin already been granted access (no popup needed)? */
export async function hasSiteAccess(): Promise<boolean> {
  try {
    const res = await withTimeout(
      freighterIsAllowed(),
      3000,
      NOT_RESPONDING_MESSAGE,
    );
    if (res.error) return false;
    return res.isAllowed;
  } catch {
    return false;
  }
}

/** Read the currently-selected address without prompting the user. */
export async function readAddress(): Promise<string> {
  const res = await withTimeout(
    freighterGetAddress(),
    4000,
    NOT_RESPONDING_MESSAGE,
  );
  if (res.error || !res.address) {
    throw new FreighterAdapterError(
      "Freighter didn't return an address. Unlock the extension and try again.",
      res.error,
    );
  }
  return res.address;
}

/** Trigger Freighter's connect popup and return the chosen address. */
export async function requestAccess(): Promise<string> {
  const res = await withTimeout(
    freighterRequestAccess(),
    45000,
    NOT_RESPONDING_MESSAGE,
  );
  if (res.error || !res.address) {
    throw new FreighterAdapterError(
      "Connection request was declined in Freighter.",
      res.error,
    );
  }
  return res.address;
}

/** Which network is Freighter currently pointed at? */
export async function readNetwork(): Promise<NetworkInfo> {
  const res = await withTimeout(
    freighterGetNetworkDetails(),
    4000,
    NOT_RESPONDING_MESSAGE,
  );
  if (res.error) {
    throw new FreighterAdapterError(
      "Couldn't read the active network from Freighter.",
      res.error,
    );
  }
  return {
    network: res.network,
    networkPassphrase: res.networkPassphrase,
    networkUrl: res.networkUrl,
    sorobanRpcUrl: res.sorobanRpcUrl,
  };
}

/** Ask Friendbot to fund a fresh/empty testnet account. */
export async function fundWithFriendbot(address: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`,
    );
  } catch (cause) {
    throw new FreighterAdapterError(
      "Couldn't reach Friendbot. Check your connection and try again.",
      cause,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Friendbot 400s an already-funded account — that's a fine outcome for us.
    if (response.status === 400 && /already funded|createAccountAlready/i.test(body)) {
      return;
    }
    throw new FreighterAdapterError(
      `Friendbot couldn't fund this account (HTTP ${response.status}).`,
      body,
    );
  }
}
