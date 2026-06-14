// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title OracleShim — minimal Chainlink-style aggregator for the forked-Mezo harness.
///
/// This stands in for Mezo's native BTC/USD oracle precompile at
/// `0x7b7c...0015`, which an anvil EVM fork cannot host (it is served by a Cosmos
/// module on the real node). It is NOT a mock of any MUSD contract (Law 5): it
/// reproduces only the external-oracle interface `PriceFeed` staticcalls, and is
/// seeded with the REAL live round data at fork boot.
///
/// Every field is read from a FIXED storage slot so the harness can seed values
/// and drive the price deterministically via `anvil_setStorageAt` — no setter, no
/// constructor, no access control.
///
/// Fixed slot layout (one field per slot):
///   slot 0: decimals          (uint8 in the low byte)
///   slot 1: roundId           (uint80)
///   slot 2: answer            (int256)
///   slot 3: startedAt         (uint256)
///   slot 4: updatedAt         (uint256)
///   slot 5: answeredInRound   (uint80)
///
/// Compile (runtime bytecode lives in `constants.ts` as ORACLE_SHIM_RUNTIME):
///   solc 0.8.35 --optimize --optimize-runs 200 --bin-runtime OracleShim.sol
contract OracleShim {
    function decimals() external view returns (uint8 d) {
        assembly {
            d := sload(0)
        }
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
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
