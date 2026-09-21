// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Subset of Perpl's Exchange (v1.7.x) used by Mandate.
/// @dev Taken from the ABI shipped in github.com/PerplFoundation/dex-sdk (crates/sdk/abi/dex/Exchange.json).
///      Units: CNS = collateral native scale (AUSD, 6 decimals); PNS = price native scale (per-perp priceDecimals);
///      LNS = lot native scale (per-perp lotDecimals); Hdths = hundredths (leverage 3x = 300).
interface IPerplExchange {
    /// @dev orderType: 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort, 4 Cancel,
    ///      5 IncreasePositionCollateral, 6 Change.
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType;
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    /// @dev positionType: 0 long, 1 short (per SDK).
    struct PositionInfo {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
    }

    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    function withdrawCollateral(uint256 amountCNS) external;
    function execOrder(OrderDesc calldata orderDesc) external returns (OrderSignature memory);
    function execOrders(OrderDesc[] calldata orderDescs, bool revertOnFail) external returns (OrderSignature[] memory);
    function allowOrderForwarding(bool allow) external;

    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory);
    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function getExchangeInfo()
        external
        view
        returns (
            uint256 balanceCNS,
            uint256 protocolBalanceCNS,
            uint256 recycleBalanceCNS,
            uint256 collateralDecimals,
            address collateralToken,
            address verifierProxy
        );
    function getPerpetualExistsBitmap() external view returns (uint256[4] memory);
    function getOrder(uint256 perpId, uint256 orderId)
        external
        view
        returns (
            uint32 accountId,
            uint8 orderType,
            uint24 priceONS,
            uint40 lotLNS,
            uint16 recycleFeeRaw,
            uint32 expiryBlock,
            uint16 leverageHdths,
            uint16 orderIdOut,
            uint16 prevOrderId,
            uint16 nextOrderId,
            uint16 maxNegPnlCollatBPS
        );
}
