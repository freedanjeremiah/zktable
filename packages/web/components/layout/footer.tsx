import { REFEREE_CONTRACT_EXPLORER_URL, REFEREE_CONTRACT_ID } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";

export function Footer() {
  return (
    <footer className="border-t-2 border-black">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-10 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>
          zkTable — trustless, privacy-preserving board games on Stellar.
        </p>
        <a
          href={REFEREE_CONTRACT_EXPLORER_URL}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-fg-muted transition-colors hover:text-black"
        >
          referee contract {truncateAddress(REFEREE_CONTRACT_ID, 6, 6)} on stellar.expert →
        </a>
      </div>
    </footer>
  );
}
