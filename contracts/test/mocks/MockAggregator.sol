// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Chainlink AggregatorV3 for tests: a settable price and update time.
contract MockAggregator {
    uint8 public decimals;
    string public description;
    int256 internal _answer;
    uint256 internal _updatedAt;
    uint80 internal _round;

    constructor(uint8 decimals_, string memory description_, int256 answer_) {
        decimals = decimals_;
        description = description_;
        _answer = answer_;
        _updatedAt = block.timestamp;
        _round = 1;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        _answer = answer_;
        _updatedAt = updatedAt_;
        ++_round;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_round, _answer, _updatedAt, _updatedAt, _round);
    }
}
