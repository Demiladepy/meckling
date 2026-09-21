// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, ExecContext} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule: account leverage (total notional / equity) stays at or below p1 bps.
/// A trade violates only if it ends above the limit AND increased total notional, so a market move that pushes
/// leverage over the limit never traps the account: risk-reducing trades always pass.
library MaxLeverageRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 > 0 && r.p2 == 0 && r.p3 == 0;
    }

    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 <= oldR.p1;
    }

    /// Leverage in bps; max int when equity is not positive but exposure exists.
    function leverageBps(int256 equity, uint256 notional) internal pure returns (int256) {
        if (notional == 0) return 0;
        if (equity <= 0) return type(int256).max;
        return StateLib.toInt(notional * 10_000 / uint256(equity));
    }

    function check(Rule memory r, ExecContext memory c) internal pure returns (bool ok, int256 observed, int256 limit) {
        observed = leverageBps(c.post.equity, c.post.totalNotional);
        limit = StateLib.toInt(r.p1);
        uint256 eq = c.post.equity > 0 ? uint256(c.post.equity) : 0;
        bool over = c.post.totalNotional * 10_000 > r.p1 * eq;
        ok = !(over && c.post.totalNotional > c.pre.totalNotional);
    }
}
