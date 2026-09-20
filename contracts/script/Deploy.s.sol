// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PrizePoolVault} from "../src/PrizePoolVault.sol";

/// @notice Deploys a standalone demo vault to Arc testnet.
/// Usage:
///   cp .env.example .env   # fill PRIVATE_KEY, ARBITER_2/3, CHALLENGE_WINDOW...
///   source .env
///   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
///
/// Required in .env (envUint/envAddress revert loudly if missing — no silent
/// defaults deploying the wrong config):
///   PRIVATE_KEY, ARBITER_2, ARBITER_3, PRIZE_POOL, CHALLENGE_WINDOW, CHALLENGE_BOND
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Demo arbiter set: 2-of-3. Deployer is admin + arbiter #1.
        address[] memory arbiters = new address[](3);
        arbiters[0] = deployer;
        arbiters[1] = vm.envAddress("ARBITER_2");
        arbiters[2] = vm.envAddress("ARBITER_3");

        // 60 / 30 / 10 podium split
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000;
        bps[1] = 3000;
        bps[2] = 1000;

        vm.startBroadcast(pk);
        PrizePoolVault vault = new PrizePoolVault({
            _admin: deployer,
            arbiters: arbiters,
            _threshold: 2,
            _tournamentId: keccak256("ARCGG_DEMO_TOURNAMENT_1"),
            _prizePool: vm.envUint("PRIZE_POOL"),
            rankBps_: bps,
            _fundingDeadline: block.timestamp + 2 days,
            _resolutionDeadline: block.timestamp + 5 days,
            _challengeWindow: vm.envUint("CHALLENGE_WINDOW"),
            _challengeBond: vm.envUint("CHALLENGE_BOND")
        });
        vm.stopBroadcast();

        console.log("Verdikt PrizePoolVault deployed at:", address(vault));
        console.log("challengeWindow (s):", vault.challengeWindow());
        console.log("Explorer: https://testnet.arcscan.app/address/%s", address(vault));
    }
}