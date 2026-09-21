// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, ExecContext} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule: exposure may only grow in markets whose id bit is set in p1. Market ids >= 256 are never allowed.
/// Reports observed = offending market id, limit = -1 (not in the allowed set).
library AllowedMarketsRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 != 0 && r.p2 == 0 && r.p3 == 0;
    }

    /// Tightening = the new set is a non-empty subset of the old one.
    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 & ~oldR.p1 == 0 && newR.p1 != 0;
    }

    function allowed(uint256 bitmap, uint256 marketId) internal pure returns (bool) {
        return marketId < 256 && (bitmap >> marketId) & 1 == 1;
    }

    function check(Rule memory r, ExecContext memory c) internal pure returns (bool ok, int256 observed, int256 limit) {
        for (uint256 i; i < c.post.markets.length; ++i) {
            uint256 id = c.post.markets[i].marketId;
            if (allowed(r.p1, id)) continue;
            if (c.post.markets[i].notional > StateLib.market(c.pre, id).notional) {
                return (false, StateLib.toInt(id), -1);
            }
        }
        return (true, 0, 0);
    }
}
