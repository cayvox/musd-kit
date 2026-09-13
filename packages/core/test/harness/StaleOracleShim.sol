// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title StaleOracleShim, the harness oracle with its freshness taken away (MK-105).
/// Identical to `OracleShim.sol` in interface and slot layout, except that `startedAt` and
/// `updatedAt` are read from storage (slots 3 and 4) instead of returning `block.timestamp`.
/// Installed only inside a snapshot, so a test can hold `updatedAt` still, warp past
/// `PriceFeed.MAX_PRICE_DELAY` (`PriceFeed.sol:14`, `:51-54`) and reach the real
/// "PriceFeed: Oracle is stale." revert, which the never-stale shim makes unreachable.
///
/// Fixed slot layout: slot 0 decimals, 1 roundId, 2 answer, 3 startedAt, 4 updatedAt, 5 answeredInRound.
contract StaleOracleShim {
    function decimals() external view returns (uint8 d) {
        assembly { d := sload(0) }
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        assembly {
            roundId := sload(1)
            answer := sload(2)
            startedAt := sload(3)
            updatedAt := sload(4)
            answeredInRound := sload(5)
        }
    }
}
