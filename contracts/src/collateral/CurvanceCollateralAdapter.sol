// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICurvanceBorrowableCToken, ICurvanceCToken, ICurvanceMarketManager} from "./ICurvance.sol";

/// @title CurvanceCollateralAdapter
/// @notice Lets a backer fund a mandate with yield-bearing collateral instead of AUSD (PRD 7.7, spike S2).
///
/// The backer posts collateral (earnAUSD by default) to one Curvance isolated market, borrows AUSD against it, and
/// sends the AUSD to their MandateAccount. The collateral keeps earning while the agent trades.
///
/// One adapter per backer position, so one backer's health never depends on another's. The position lives in this
/// contract's name on Curvance; only the backer can add, borrow or withdraw, and anyone can repay.
///
/// The safety rule: debt may never exceed `maxUseBps` of what Curvance itself would lend, and `maxUseBps` is at most
/// half. The check uses Curvance's own `statusOf` valuation, so the adapter never prices anything itself.
contract CurvanceCollateralAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// PRD 7.7: borrow at most 50% of Curvance's maximum.
    uint256 public constant MAX_USE_OF_CURVANCE_BPS = 5_000;

    address public immutable owner;
    ICurvanceCToken public immutable collateralCToken;
    ICurvanceBorrowableCToken public immutable debtCToken;
    ICurvanceMarketManager public immutable market;
    IERC20 public immutable collateralAsset;
    IERC20 public immutable debtAsset;
    /// Share of Curvance's maximum debt this position may use, in bps. At most MAX_USE_OF_CURVANCE_BPS.
    uint256 public immutable maxUseBps;

    event Supplied(uint256 assets);
    event Borrowed(address indexed receiver, uint256 assets, uint256 debt, uint256 maxDebt);
    event Repaid(address indexed payer, uint256 assets);
    event CollateralWithdrawn(address indexed to, uint256 assets);

    error Unauthorized();
    error ZeroAmount();
    error BadUseBps(uint256 bps);
    error NotSameListedMarket();
    /// @param debt Debt after the action, in Curvance's value units.
    /// @param cap The most this position may owe, in the same units.
    error ExceedsBorrowCap(uint256 debt, uint256 cap);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address owner_,
        ICurvanceCToken collateralCToken_,
        ICurvanceBorrowableCToken debtCToken_,
        uint256 maxUseBps_
    ) {
        if (maxUseBps_ == 0 || maxUseBps_ > MAX_USE_OF_CURVANCE_BPS) {
            revert BadUseBps(maxUseBps_);
        }
        address mm = collateralCToken_.marketManager();
        if (mm == address(0) || debtCToken_.marketManager() != mm) revert NotSameListedMarket();
        ICurvanceMarketManager m = ICurvanceMarketManager(mm);
        if (!m.isListed(address(collateralCToken_)) || !m.isListed(address(debtCToken_))) revert NotSameListedMarket();

        owner = owner_;
        collateralCToken = collateralCToken_;
        debtCToken = debtCToken_;
        market = m;
        collateralAsset = IERC20(collateralCToken_.asset());
        debtAsset = IERC20(debtCToken_.asset());
        maxUseBps = maxUseBps_;
    }

    // ---------------------------------------------------------------- backer actions

    /// @notice Posts `assets` of the backer's collateral to Curvance in this position's name.
    function supply(uint256 assets) external onlyOwner nonReentrant {
        _supply(assets);
    }

    /// @notice Borrows `assets` AUSD and sends it to `receiver` (normally the backer's MandateAccount).
    function borrowTo(uint256 assets, address receiver) external onlyOwner nonReentrant {
        _borrow(assets, receiver);
    }

    /// @notice Posts collateral and borrows against it in one transaction: the usual way to fund a mandate.
    function fund(uint256 collateralAssets, uint256 borrowAssets, address receiver) external onlyOwner nonReentrant {
        _supply(collateralAssets);
        _borrow(borrowAssets, receiver);
    }

    /// @notice Returns collateral to `to`. Curvance enforces its own solvency and hold period; this also enforces
    ///         the half-of-Curvance cap, so collateral can't be pulled out from under a loan.
    function withdrawCollateral(uint256 assets, address to) external onlyOwner nonReentrant {
        if (assets == 0) revert ZeroAmount();
        collateralCToken.withdrawCollateral(assets, to, address(this));
        _enforceCap();
        emit CollateralWithdrawn(to, assets);
    }

    /// @notice Repays `assets` of the loan from the caller's AUSD. Anyone may repay; it only ever lowers risk.
    function repay(uint256 assets) external nonReentrant {
        if (assets == 0) revert ZeroAmount();
        debtAsset.safeTransferFrom(msg.sender, address(this), assets);
        debtAsset.forceApprove(address(debtCToken), assets);
        debtCToken.repay(assets);
        emit Repaid(msg.sender, assets);
    }

    // ---------------------------------------------------------------- views

    /// @notice Curvance's own view of this position: collateral value, the most it would lend, and current debt.
    /// @dev Nonpayable because Curvance accrues interest first; read it with eth_call.
    function health() external returns (uint256 collateral, uint256 maxDebt, uint256 debt) {
        return market.statusOf(address(this));
    }

    // ---------------------------------------------------------------- internals

    function _supply(uint256 assets) internal {
        if (assets == 0) revert ZeroAmount();
        collateralAsset.safeTransferFrom(msg.sender, address(this), assets);
        collateralAsset.forceApprove(address(collateralCToken), assets);
        collateralCToken.depositAsCollateral(assets, address(this));
        emit Supplied(assets);
    }

    function _borrow(uint256 assets, address receiver) internal {
        if (assets == 0) revert ZeroAmount();
        debtCToken.borrow(assets, receiver);
        (uint256 debt, uint256 maxDebt) = _enforceCap();
        emit Borrowed(receiver, assets, debt, maxDebt);
    }

    function _enforceCap() internal returns (uint256 debt, uint256 maxDebt) {
        (, maxDebt, debt) = market.statusOf(address(this));
        uint256 cap = (maxDebt * maxUseBps) / 10_000;
        if (debt > cap) revert ExceedsBorrowCap(debt, cap);
    }
}
