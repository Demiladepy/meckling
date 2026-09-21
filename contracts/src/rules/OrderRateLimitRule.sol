// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, Monitor, ExecContext} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule, temporal: at most p1 order placements per fixed window of p2 blocks.
/// Monitor: w0 = window start block, w1 = orders placed in the window.
library OrderRateLimitRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 > 0 && r.p2 > 0 && r.p3 == 0;
    }

    /// Fewer orders over a window at least as long is stricter.
    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 <= oldR.p1 && newR.p2 >= oldR.p2;
    }

    function update(Monitor storage m, Rule memory r, ExecContext memory c) internal returns (bool changed) {
        if (c.ordersPlaced == 0) return false;
        if (m.w1 == 0 || block.number >= m.w0 + r.p2) {
            m.w0 = block.number;
            m.w1 = 0;
        }
        m.w1 += c.ordersPlaced;
        return true;
    }

    function check(Monitor storage m, Rule memory r, ExecContext memory c)
        internal
        view
        returns (bool ok, int256 observed, int256 limit)
    {
        limit = StateLib.toInt(r.p1);
        if (c.ordersPlaced == 0) return (true, 0, limit);
        observed = StateLib.toInt(m.w1);
        ok = m.w1 <= r.p1;
    }
}
