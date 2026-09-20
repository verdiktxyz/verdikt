// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VerdiktFactory} from "../src/VerdiktFactory.sol";

/// @notice Deploys the Verdikt factory (once per chain).
///   source .env && forge script script/DeployFactory.s.sol --rpc-url arc_testnet --broadcast
contract DeployFactory is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        VerdiktFactory factory = new VerdiktFactory();
        vm.stopBroadcast();

        console.log("VerdiktFactory deployed at:", address(factory));
        console.log("Explorer: https://testnet.arcscan.app/address/%s", address(factory));
    }
}
