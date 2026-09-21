// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Venue abstraction. MandateAccount never decodes venue calldata or reads venue state itself; it asks the
///         adapter. Adapters are stateless view contracts and never hold funds.
/// @dev Changes from PRD 7.1, recorded in docs/decisions.md:
///      - AccountState carries the per-market list, so rules see every open market from one snapshot.
///      - `inspectCall` replaces a bare target allowlist: Perpl exposes `allowOrderForwarding`, which would let
///        orders bypass `execute`, so every call is checked by selector and order type (spike S1).
///      - `exchange()` and `encodeWithdraw` added; placing orders is done by the caller's own calldata.
interface IVenue {
    struct MarketState {
        uint256 marketId;
        int256 size; // signed position size in venue lot units (long > 0)
        uint256 mark; // venue mark price in venue price units
        bool markValid;
        uint256 notional; // |size| * mark, in collateral units (AUSD, 6 decimals)
        int256 upnl; // unrealized PnL including funding, collateral units
    }

    struct AccountState {
        int256 equity; // idle collateral in the account + venue balance + position deposits + unrealized PnL
        uint256 totalNotional; // sum of market notionals
        uint256 marginUsed; // position deposits + collateral locked by resting orders
        MarketState[] markets; // only markets with a nonzero position
    }

    /// Outcome of checking one call the account is about to make.
    struct CallCheck {
        bool allowed;
        uint256 ordersPlaced; // order placements (opens and closes), for OrderRateLimit
    }

    function exchange() external view returns (address);
    function collateralToken() external view returns (address);

    function accountState(address account) external view returns (AccountState memory);
    function marketState(address account, uint256 marketId) external view returns (MarketState memory);

    /// @param closeOnly when true, only calls that cannot increase exposure are allowed.
    function inspectCall(address target, bytes calldata data, bool closeOnly) external view returns (CallCheck memory);

    function encodeWithdraw(uint256 amount) external view returns (address target, bytes memory data);
}
