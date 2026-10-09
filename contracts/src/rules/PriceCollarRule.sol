// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, ExecContext} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule (optional, D14): no order that opens or adds exposure may carry a limit price more than p1 bps from the
/// venue mark. SEC Rule 15c3-5 requires brokers to reject "erroneous orders" that exceed price parameters; this is that
/// check for an agent, enforced inside its own trade. It stops a fat-fingered or manipulated price, the way Knight
/// Capital lost more than $460M in 45 minutes in 2012.
///
/// An order with no limit price, or placed while the mark is unavailable, measures as unbounded and is blocked.
/// Closes are never measured, so the collar can never trap a position.
library PriceCollarRule {
    uint256 internal constant MAX_BPS = 10_000;

    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 > 0 && r.p1 <= MAX_BPS && r.p2 == 0 && r.p3 == 0;
    }

    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 <= oldR.p1;
    }

    /// Distance of a limit price from the mark in bps, rounded up so a hair over the limit never passes. Returns
    /// type(uint256).max ("unbounded") for a missing price or mark, or a distance too large to compute without
    /// overflow, so it never reverts. Proven in test/formal/RuleProofs.t.sol: never under-reports, at most 1 bps over.
    function deviationBps(uint256 price, uint256 mark) internal pure returns (uint256) {
        if (price == 0 || mark == 0) return type(uint256).max;
        uint256 diff = price > mark ? price - mark : mark - price;
        if (diff > (type(uint256).max - mark) / 10_000) return type(uint256).max;
        return (diff * 10_000 + mark - 1) / mark;
    }

    function check(Rule memory r, ExecContext memory c) internal pure returns (bool ok, int256 observed, int256 limit) {
        ok = c.maxPriceDeviationBps <= r.p1;
        observed = StateLib.toInt(c.maxPriceDeviationBps); // saturates, so "unbounded" reports as int256 max
        limit = StateLib.toInt(r.p1);
    }
}
