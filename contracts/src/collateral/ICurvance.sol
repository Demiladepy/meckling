// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The subset of Curvance's isolated-market contracts the collateral adapter uses.
/// @dev Signatures from github.com/curvance-web/sdk (src/abis/*.json), confirmed on Monad mainnet; see docs/spikes.md S2.
interface ICurvanceCToken {
    function asset() external view returns (address);
    function marketManager() external view returns (address);
    function depositAsCollateral(uint256 assets, address receiver) external returns (uint256 shares);
    function withdrawCollateral(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function collateralPosted(address account) external view returns (uint256);
}

interface ICurvanceBorrowableCToken is ICurvanceCToken {
    function borrow(uint256 assets, address receiver) external;
    function repay(uint256 assets) external;
    function debtBalance(address account) external view returns (uint256);
}

interface ICurvanceMarketManager {
    function isListed(address cToken) external view returns (bool);
    function collConfig(address cToken)
        external
        view
        returns (uint256 collRatio, uint256 collReqSoft, uint256 collReqHard);
    /// @dev Nonpayable because it accrues interest first. Off-chain readers use eth_call.
    function statusOf(address account) external returns (uint256 collateral, uint256 maxDebt, uint256 debt);
}
