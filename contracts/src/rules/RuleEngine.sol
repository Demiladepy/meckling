// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RuleKind, Rule, Monitor, ExecContext} from "./RuleTypes.sol";
import {MaxLeverageRule} from "./MaxLeverageRule.sol";
import {MaxNotionalPerMarketRule} from "./MaxNotionalPerMarketRule.sol";
import {AllowedMarketsRule} from "./AllowedMarketsRule.sol";
import {OrderRateLimitRule} from "./OrderRateLimitRule.sol";
import {LossCooldownRule} from "./LossCooldownRule.sol";
import {MaxDrawdownRule} from "./MaxDrawdownRule.sol";

/// Dispatches to the per-rule libraries. MandateAccount's control flow is: update every monitor, then check every
/// action rule; adding a rule means adding a library and a branch here, never changing the account.
library RuleEngine {
    uint256 internal constant MAX_RULES = 16;

    function isMarketRule(RuleKind kind) internal pure returns (bool) {
        return kind == RuleKind.MaxDrawdown;
    }

    function validate(Rule memory r) internal pure returns (bool) {
        if (r.kind == RuleKind.MaxLeverage) return MaxLeverageRule.validate(r);
        if (r.kind == RuleKind.MaxNotionalPerMarket) return MaxNotionalPerMarketRule.validate(r);
        if (r.kind == RuleKind.AllowedMarkets) return AllowedMarketsRule.validate(r);
        if (r.kind == RuleKind.OrderRateLimit) return OrderRateLimitRule.validate(r);
        if (r.kind == RuleKind.LossCooldown) return LossCooldownRule.validate(r);
        return MaxDrawdownRule.validate(r);
    }

    /// True iff `newR` is the same kind and at least as strict as `oldR`.
    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        if (oldR.kind != newR.kind || newR.p3 != oldR.p3 || !validate(newR)) return false;
        if (newR.kind == RuleKind.MaxLeverage) return MaxLeverageRule.isTightening(oldR, newR);
        if (newR.kind == RuleKind.MaxNotionalPerMarket) return MaxNotionalPerMarketRule.isTightening(oldR, newR);
        if (newR.kind == RuleKind.AllowedMarkets) return AllowedMarketsRule.isTightening(oldR, newR);
        if (newR.kind == RuleKind.OrderRateLimit) return OrderRateLimitRule.isTightening(oldR, newR);
        if (newR.kind == RuleKind.LossCooldown) return LossCooldownRule.isTightening(oldR, newR);
        return MaxDrawdownRule.isTightening(oldR, newR);
    }

    /// Updates the monitor for rule `r` after an execute. Returns true if its state changed.
    function update(Monitor storage m, Rule memory r, ExecContext memory c) internal returns (bool) {
        if (r.kind == RuleKind.OrderRateLimit) return OrderRateLimitRule.update(m, r, c);
        if (r.kind == RuleKind.LossCooldown) return LossCooldownRule.update(m, r, c);
        if (r.kind == RuleKind.MaxDrawdown) return MaxDrawdownRule.updatePeak(m, c.post.equity);
        return false;
    }

    /// Checks action rule `r` against the execute. Market rules always pass here (they never revert a trade).
    function checkAction(Monitor storage m, Rule memory r, ExecContext memory c)
        internal
        view
        returns (bool ok, int256 observed, int256 limit)
    {
        if (r.kind == RuleKind.MaxLeverage) return MaxLeverageRule.check(r, c);
        if (r.kind == RuleKind.MaxNotionalPerMarket) return MaxNotionalPerMarketRule.check(r, c);
        if (r.kind == RuleKind.AllowedMarkets) return AllowedMarketsRule.check(r, c);
        if (r.kind == RuleKind.OrderRateLimit) return OrderRateLimitRule.check(m, r, c);
        if (r.kind == RuleKind.LossCooldown) return LossCooldownRule.check(m, r, c);
        return (true, 0, 0);
    }

    /// Checks market rule `r` against the current equity (used by BondVault in M2).
    function checkMarket(Monitor storage m, Rule memory r, int256 equity)
        internal
        view
        returns (bool ok, int256 observed, int256 limit)
    {
        if (r.kind == RuleKind.MaxDrawdown) return MaxDrawdownRule.check(m, r, equity);
        return (true, 0, 0);
    }
}
