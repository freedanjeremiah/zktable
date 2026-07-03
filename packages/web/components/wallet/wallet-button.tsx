"use client";

import { AlertTriangle, Check, Copy, Droplets, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { truncateAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet/wallet-context";

const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (wallet.status === "checking") {
    return (
      <Button variant="ghost" size="sm" disabled className="opacity-60">
        <Wallet className="h-3.5 w-3.5" />
        Checking…
      </Button>
    );
  }

  if (wallet.status === "not-installed") {
    return (
      <a
        href={FREIGHTER_INSTALL_URL}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <Wallet className="h-3.5 w-3.5" />
        Install Freighter
      </a>
    );
  }

  if (wallet.status === "connected" && wallet.address) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="font-mono"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-success"
            aria-hidden
          />
          {truncateAddress(wallet.address)}
          {!wallet.isTestnet ? (
            <AlertTriangle className="h-3.5 w-3.5 text-danger" />
          ) : null}
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Wallet"
          description="Freighter, Stellar testnet."
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border-2 border-black bg-bg-elevated px-3 py-2">
              <span className="truncate font-mono text-sm text-fg">
                {wallet.address}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(wallet.address ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-fg-subtle hover:bg-bg-panel hover:text-fg"
                aria-label="Copy address"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={wallet.isTestnet ? "accent" : "outline"}>
                {wallet.network ?? "unknown network"}
              </Badge>
              {!wallet.isTestnet ? (
                <span className="text-xs text-fg-subtle">
                  Switch Freighter to Testnet to play.
                </span>
              ) : null}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={wallet.isFunding}
              onClick={() => void wallet.fundFromFriendbot()}
            >
              <Droplets className="h-3.5 w-3.5" />
              {wallet.isFunding ? "Funding…" : "Fund from Friendbot"}
            </Button>
            {wallet.error ? (
              <p className="text-xs text-danger">{wallet.error}</p>
            ) : null}

            <button
              type="button"
              onClick={() => {
                wallet.disconnect();
                setOpen(false);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] py-2 text-xs text-fg-subtle hover:text-fg"
            >
              <LogOut className="h-3.5 w-3.5" />
              Forget this session
            </button>
          </div>
        </Dialog>
      </>
    );
  }

  if (wallet.status === "error") {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="text-danger"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Connection failed
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Couldn't connect"
          description={wallet.error ?? "Something went wrong."}
        >
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              void wallet.connect();
            }}
          >
            Try again
          </Button>
        </Dialog>
      </>
    );
  }

  // disconnected | connecting
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={wallet.status === "connecting"}
      onClick={() => void wallet.connect()}
    >
      <Wallet className="h-3.5 w-3.5" />
      {wallet.status === "connecting" ? "Connecting…" : "Connect Wallet"}
    </Button>
  );
}
