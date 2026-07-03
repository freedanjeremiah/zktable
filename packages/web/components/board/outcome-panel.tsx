import { ExternalLink, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifiedStamp } from "@/components/proof/verified-stamp";
import type { MatchDtoOutcome } from "@/lib/blackout/dto";

export interface OutcomePanelProps {
  outcome: MatchDtoOutcome;
  explorerUrl: string;
  onNewMatch: () => void;
}

export function OutcomePanel({ outcome, explorerUrl, onNewMatch }: OutcomePanelProps) {
  const investigatorsWon = outcome.role === "investigator";

  return (
    <Card className="border-black">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant={investigatorsWon ? "accent" : "hidden"}>Match over</Badge>
          <VerifiedStamp label="Outcome verified on-chain" />
        </div>
        <CardTitle className="mt-2">
          {investigatorsWon ? "The Investigators cornered the Phantom" : "The Phantom slipped away"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {investigatorsWon
            ? "A revealed position matched an Investigator's node — the referee resolved the capture on-chain."
            : "The Phantom reached the final reveal round without being caught on a revealed node."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-bold text-black underline decoration-accent decoration-[3px] underline-offset-2 hover:decoration-black"
          >
            Verify the referee on stellar.expert
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="border-t-2 border-black pt-4">
          <Button variant="primary" onClick={onNewMatch}>
            <RotateCcw className="h-4 w-4" />
            New match
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
