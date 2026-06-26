"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  FreighterAdapterError,
  fundWithFriendbot as adapterFundWithFriendbot,
  hasSiteAccess,
  isFreighterInstalled,
  readAddress,
  readNetwork,
  requestAccess,
  TESTNET_PASSPHRASE,
} from "./freighter-adapter";

export type WalletStatus =
  | "checking" // reading extension state on mount
  | "not-installed" // no Freighter extension detected
  | "disconnected" // installed, not yet granted access to this origin
  | "connecting" // popup open, awaiting the player
  | "connected" // have an address
  | "error";

export interface WalletContextValue {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  isTestnet: boolean;
  error: string | null;
  /** Open Freighter's connect popup. */
  connect: () => Promise<void>;
  /** Forget the address locally. Freighter's own permission stays granted
   *  (that can only be revoked from inside the extension). */
  disconnect: () => void;
  /** Ask Friendbot to fund the connected address on testnet. */
  fundFromFriendbot: () => Promise<void>;
  /** True while a Friendbot request is in flight. */
  isFunding: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFunding, setIsFunding] = useState(false);

  const loadNetwork = useCallback(async () => {
    try {
      const info = await readNetwork();
      setNetwork(info.network);
    } catch {
      setNetwork(null);
    }
  }, []);

  // On mount: silently pick up an already-granted session, without
  // triggering the connect popup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const installed = await isFreighterInstalled();
      if (cancelled) return;
      if (!installed) {
        setStatus("not-installed");
        return;
      }
      const allowed = await hasSiteAccess();
      if (cancelled) return;
      if (!allowed) {
        setStatus("disconnected");
        return;
      }
      try {
        const addr = await readAddress();
        if (cancelled) return;
        setAddress(addr);
        await loadNetwork();
        if (cancelled) return;
        setStatus("connected");
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadNetwork]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const installed = await isFreighterInstalled();
      if (!installed) {
        setStatus("not-installed");
        return;
      }
      const addr = await requestAccess();
      setAddress(addr);
      await loadNetwork();
      setStatus("connected");
    } catch (err) {
      const message =
        err instanceof FreighterAdapterError
          ? err.message
          : "Couldn't connect to Freighter. Please try again.";
      setError(message);
      setStatus("error");
    }
  }, [loadNetwork]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
    setError(null);
    setStatus("disconnected");
  }, []);

  const fundFromFriendbot = useCallback(async () => {
    if (!address) return;
    setError(null);
    setIsFunding(true);
    try {
      await adapterFundWithFriendbot(address);
    } catch (err) {
      setError(
        err instanceof FreighterAdapterError
          ? err.message
          : "Friendbot funding failed.",
      );
    } finally {
      setIsFunding(false);
    }
  }, [address]);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      address,
      network,
      isTestnet: network === "TESTNET" || network === TESTNET_PASSPHRASE,
      error,
      connect,
      disconnect,
      fundFromFriendbot,
      isFunding,
    }),
    [status, address, network, error, connect, disconnect, fundFromFriendbot, isFunding],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
