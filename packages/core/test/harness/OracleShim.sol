// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title OracleShim, minimal Chainlink-style aggregator for the forked-Mezo harness.
/// Stands in for Mezo's native BTC/USD oracle precompile (which anvil cannot host).
/// NOT a mock of any MUSD contract: it reproduces only the external-oracle
/// interface PriceFeed reads, seeded with REAL live round data.
///
/// `startedAt`/`updatedAt` return `block.timestamp` so the feed is NEVER "stale" to
/// PriceFeed's freshness guard, anvil advances block time by wall-clock and the
/// harness can warp it arbitrarily, so a static timestamp would trip staleness.
/// The price (`answer`) and `roundId` remain controllable via storage slots.
///
/// Fixed slot layout: slot 0 decimals, 1 roundId, 2 answer, 5 answeredInRound.
contract OracleShim {
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
            startedAt := timestamp()
            updatedAt := timestamp()
            answeredInRound := sload(5)
        }
    }
}
