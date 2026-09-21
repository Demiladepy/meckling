// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Rule, Monitor, ExecContext} from "./RuleTypes.sol";
import {IVenue} from "../venues/IVenue.sol";
import {StateLib} from "./StateLib.sol";

/// Action rule, temporal ("no revenge trading"): if a trade realizes a loss >= p1, then for the next p2 blocks any
/// trade that increases total notional reverts.
/// Monitor: w0 = block of the last qualifying loss + 1 (0 = never).
/// Realized PnL of a trade = for each market whose position shrank or flipped, the pre-trade unrealized PnL times
/// the fraction of the position closed. Fees and slippage are excluded.
library LossCooldownRule {
    function validate(Rule memory r) internal pure returns (bool) {
        return r.p1 > 0 && r.p2 > 0 && r.p3 == 0;
    }

    /// A lower loss threshold (triggers more often) and a longer cooldown are both stricter.
    function isTightening(Rule memory oldR, Rule memory newR) internal pure returns (bool) {
        return newR.p1 <= oldR.p1 && newR.p2 >= oldR.p2;
    }

    function realizedPnl(IVenue.AccountState memory pre, IVenue.AccountState memory post)
        internal
        pure
        returns (int256 realized)
    {
        for (uint256 i; i < pre.markets.length; ++i) {
            IVenue.MarketState memory a = pre.markets[i];
            if (a.size == 0) continue;
            int256 b = StateLib.market(post, a.marketId).size;
            uint256 preAbs = StateLib.abs(a.size);
            // Size left on the same side; a flip or a full close leaves nothing of the old position.
            uint256 left = b != 0 && (b > 0) == (a.size > 0) ? StateLib.abs(b) : 0;
            if (left >= preAbs) continue;
            realized += a.upnl * int256(preAbs - left) / int256(preAbs);
        }
    }

    function update(Monitor storage m, Rule memory r, ExecContext memory c) internal returns (bool changed) {
        int256 realized = realizedPnl(c.pre, c.post);
        if (realized < 0 && StateLib.abs(realized) >= r.p1) {
            m.w0 = block.number + 1;
            return true;
        }
    }

    /// observed = blocks since the last qualifying loss, limit = cooldown length.
    function check(Monitor storage m, Rule memory r, ExecContext memory c)
        internal
        view
        returns (bool ok, int256 observed, int256 limit)
    {
        limit = StateLib.toInt(r.p2);
        if (m.w0 == 0) return (true, limit, limit);
        uint256 since = block.number - (m.w0 - 1);
        observed = StateLib.toInt(since);
        ok = since >= r.p2 || c.post.totalNotional <= c.pre.totalNotional;
    }

    /// Blocks left in the cooldown (0 when ready), for UIs and the agent.
    function remaining(Monitor storage m, Rule memory r) internal view returns (uint256) {
        if (m.w0 == 0) return 0;
        uint256 since = block.number - (m.w0 - 1);
        return since >= r.p2 ? 0 : r.p2 - since;
    }
}
