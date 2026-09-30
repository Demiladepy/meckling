// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVenue} from "../venues/IVenue.sol";

/// Rule kinds and parameters, PRD 7.2 / 7.4. Parameters are bps or raw collateral units; all windows count blocks.
enum RuleKind {
    MaxLeverage, // p1 = max leverage in bps of equity (30000 = 3x)
    MaxNotionalPerMarket, // p1 = marketId, p2 = max notional (collateral units)
    AllowedMarkets, // p1 = bitmap of allowed market ids (ids 0..255)
    OrderRateLimit, // p1 = max orders, p2 = window in blocks (fixed windows)
    LossCooldown, // p1 = realized loss threshold (collateral units), p2 = cooldown blocks
    MaxDrawdown, // p1 = max drawdown in bps from equity peak (market rule, M2)
    PriceCollar // p1 = max bps between an opening order's limit price and the venue mark (optional, D14)
}

struct Rule {
    RuleKind kind;
    uint256 p1;
    uint256 p2;
    uint256 p3;
}

/// Constant-size monitor state per rule (the temporal rules' state machines). Meaning depends on the rule kind.
struct Monitor {
    uint256 w0;
    uint256 w1;
}

/// Everything a rule sees about one execute.
struct ExecContext {
    IVenue.AccountState pre;
    IVenue.AccountState post;
    uint256 ordersPlaced;
    /// Worst limit-price distance from the mark across this execute's opening orders, in bps (max when unknown).
    /// Measured only when the mandate has a PriceCollar rule; 0 otherwise.
    uint256 maxPriceDeviationBps;
}
