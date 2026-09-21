// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, Monitor} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Market rule, temporal: equity >= peak * (10000 - p1) / 10000. Monitor: w0 = equity peak (non-decreasing).
/// Never reverts an execute; BondVault.flagBreach checks it (M2). The peak is updated on every execute and poke.
library MaxDrawdownRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 > 0 && r.p1 < 10_000 && r.p2 == 0 && r.p3 == 0;
    }

    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 <= oldR.p1;
    }

    function updatePeak(Monitor storage m, int256 equity) internal returns (bool changed) {
        if (equity > 0 && uint256(equity) > m.w0) {
            m.w0 = uint256(equity);
            return true;
        }
    }

    /// observed = current drawdown from peak in bps, limit = p1.
    function check(Monitor storage m, Rule memory r, int256 equity)
        internal
        view
        returns (bool ok, int256 observed, int256 limit)
    {
        limit = StateLib.toInt(r.p1);
        uint256 peak = m.w0;
        if (peak == 0) return (true, 0, limit);
        uint256 eq = equity > 0 ? uint256(equity) : 0;
        observed = eq >= peak ? int256(0) : StateLib.toInt((peak - eq) * 10_000 / peak);
        ok = eq * 10_000 >= peak * (10_000 - r.p1);
    }
}
