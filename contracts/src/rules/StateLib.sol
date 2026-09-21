// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVenue} from "../venues/IVenue.sol";

/// Helpers for reading venue snapshots.
library StateLib {
    /// Returns the market's state in `s`, or a zero state if the account has no position there.
    function market(IVenue.AccountState memory s, uint256 marketId)
        internal
        pure
        returns (IVenue.MarketState memory m)
    {
        for (uint256 i; i < s.markets.length; ++i) {
            if (s.markets[i].marketId == marketId) return s.markets[i];
        }
        m.marketId = marketId;
    }

    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    /// Saturating uint -> int conversion for reporting observed/limit values.
    function toInt(uint256 x) internal pure returns (int256) {
        return x > uint256(type(int256).max) ? type(int256).max : int256(x);
    }
}
