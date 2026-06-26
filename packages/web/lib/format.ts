/** Shorten a Stellar address to `GABC…WXYZ` for compact display. */
export function truncateAddress(address: string, lead = 4, trail = 4): string {
  if (address.length <= lead + trail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-trail)}`;
}
