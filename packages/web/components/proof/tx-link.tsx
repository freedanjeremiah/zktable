import { ExternalLink } from "lucide-react";

/** Anchor to the submitted transaction on stellar.expert — rendered next to
 *  every on-chain action so each move is one click from its public record. */
export function TxLink({ tx }: { tx?: string | null }) {
  if (!tx) return null;
  return (
    <a
      href={`https://stellar.expert/explorer/testnet/tx/${tx}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-[0.65rem] font-bold text-black underline decoration-accent decoration-2 underline-offset-2 hover:decoration-black"
      title={`transaction ${tx}`}
    >
      tx
      <ExternalLink className="h-2.5 w-2.5" aria-hidden />
    </a>
  );
}
