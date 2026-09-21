// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, ExecContext} from "./RuleTypes.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule: notional in market p1 stays at or below p2. Only trades that grow that market's notional can violate.
library MaxNotionalPerMarketRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p2 > 0 && r.p3 == 0;
    }

    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 == oldR.p1 && newR.p2 <= oldR.p2;
    }

    function check(Rule memory r, ExecContext memory c) internal pure returns (bool ok, int256 observed, int256 limit) {
        uint256 postN = StateLib.market(c.post, r.p1).notional;
        uint256 preN = StateLib.market(c.pre, r.p1).notional;
        observed = StateLib.toInt(postN);
        limit = StateLib.toInt(r.p2);
        ok = !(postN > r.p2 && postN > preN);
    }
}
