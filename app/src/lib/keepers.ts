/**
 * The CreKeeperReceiver contracts on Monad testnet: when one of these is a breach's reporter, the breach was flagged by
 * the Chainlink CRE workflow through Chainlink's forwarder, not by any key of ours (docs/cre-simulation.md).
 */
const CRE_RECEIVERS = new Set(
  [
    "0x129712c1b853067e0f5c1b9f214397c719a6242B", // current contracts (Oct 7)
    "0x0ebECec6eA87650D9bBcc4F553d0f4713b09beAc", // first deployment (Sep 29)
  ].map((a) => a.toLowerCase()),
);

/** Plain words for who flagged a breach. */
export function flaggedBy(reporter: string | undefined): string | undefined {
  if (!reporter) return undefined;
  return CRE_RECEIVERS.has(reporter.toLowerCase()) ? "Chainlink CRE workflow" : "keeper";
}
