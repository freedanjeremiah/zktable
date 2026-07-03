import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/wallet/wallet-button";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/arcade", label: "Arcade" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-fg"
          >
            <span
              className="h-2 w-2 rounded-full bg-accent"
              aria-hidden
            />
            zkTable
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex">
            Stellar Testnet
          </Badge>
        </div>

        {/* Two short links — visible at every size (no mobile menu needed). */}
        <nav className="flex items-center gap-4 md:gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
