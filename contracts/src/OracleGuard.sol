// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IVenue} from "./venues/IVenue.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Guards market-rule breaches against a manipulated or stale venue mark (PRD 7.5). A breach can only be
///         flagged when the venue's mark agrees with a Chainlink feed for the same market.
/// @dev The owner can only configure feeds. It cannot flag, slash, or move funds. A market with no feed is never
///      trusted, so an unconfigured market blocks flagging rather than allowing an unchecked one.
contract OracleGuard is Ownable2Step {
    struct Feed {
        IAggregatorV3 aggregator;
        uint32 maxAgeSec; // reject prices older than this
        uint16 tolBps; // allowed gap between venue mark and feed
        bool set;
    }

    IVenue public immutable venue;
    mapping(uint256 marketId => Feed) public feeds;

    event FeedSet(uint256 indexed marketId, address aggregator, uint32 maxAgeSec, uint16 tolBps);
    event FeedCleared(uint256 indexed marketId);

    error NoFeed(uint256 marketId);
    error BadConfig();

    constructor(IVenue venue_, address admin) Ownable(admin) {
        venue = venue_;
    }

    function setFeed(uint256 marketId, IAggregatorV3 aggregator, uint32 maxAgeSec, uint16 tolBps) external onlyOwner {
        if (address(aggregator) == address(0) || maxAgeSec == 0 || tolBps == 0 || tolBps > 2_000) revert BadConfig();
        feeds[marketId] = Feed(aggregator, maxAgeSec, tolBps, true);
        emit FeedSet(marketId, address(aggregator), maxAgeSec, tolBps);
    }

    function clearFeed(uint256 marketId) external onlyOwner {
        delete feeds[marketId];
        emit FeedCleared(marketId);
    }

    /// @notice The feed's price for `marketId`, normalized to 1e18.
    function referencePrice(uint256 marketId) public view returns (uint256 price, uint256 updatedAt) {
        Feed memory f = feeds[marketId];
        if (!f.set) revert NoFeed(marketId);
        (, int256 answer,, uint256 at,) = f.aggregator.latestRoundData();
        if (answer <= 0) return (0, at);
        return (uint256(answer) * 1e18 / 10 ** f.aggregator.decimals(), at);
    }

    /// @notice True when `marketId`'s venue mark is valid, the feed is fresh, and the two agree within tolerance.
    /// @return ok whether the mark can be trusted
    /// @return markE18 the venue mark, normalized to 1e18
    /// @return refE18 the feed price, normalized to 1e18
    function markIsTrusted(address account, uint256 marketId)
        public
        view
        returns (bool ok, uint256 markE18, uint256 refE18)
    {
        Feed memory f = feeds[marketId];
        if (!f.set) return (false, 0, 0);

        IVenue.MarketState memory m = venue.marketState(account, marketId);
        if (!m.markValid || m.mark == 0) return (false, 0, 0);
        markE18 = m.mark * 1e18 / venue.priceScale(marketId);

        uint256 at;
        (refE18, at) = referencePrice(marketId);
        if (refE18 == 0 || block.timestamp > at + f.maxAgeSec) return (false, markE18, refE18);

        uint256 gap = markE18 > refE18 ? markE18 - refE18 : refE18 - markE18;
        ok = gap * 10_000 <= refE18 * f.tolBps;
    }

    /// @notice True when every market `account` holds a position in has a trustworthy mark. An account with no
    ///         positions is trivially trusted: its equity is cash, and no mark can distort it.
    function accountMarksTrusted(address account) external view returns (bool) {
        IVenue.MarketState[] memory markets = venue.accountState(account).markets;
        for (uint256 i; i < markets.length; ++i) {
            (bool ok,,) = markIsTrusted(account, markets[i].marketId);
            if (!ok) return false;
        }
        return true;
    }
}
