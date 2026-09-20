// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerdiktFactory} from "../src/VerdiktFactory.sol";
import {PrizePoolVault} from "../src/PrizePoolVault.sol";

contract VerdiktFactoryTest is Test {
    VerdiktFactory factory;

    address organizer = makeAddr("organizer");
    uint256 arbPk1 = 0xA11CE;
    uint256 arbPk2 = 0xB0B;
    address arb1;
    address arb2;
    address arb3 = makeAddr("arb3");
    address player = makeAddr("player");

    function setUp() public {
        arb1 = vm.addr(arbPk1);
        arb2 = vm.addr(arbPk2);
        factory = new VerdiktFactory();
        vm.deal(organizer, 100 ether);
        vm.deal(player, 1 ether);
    }

    function _create(string memory name) internal returns (PrizePoolVault v) {
        address[] memory arbiters = new address[](3);
        arbiters[0] = arb1;
        arbiters[1] = arb2;
        arbiters[2] = arb3;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000;
        bps[1] = 3000;
        bps[2] = 1000;

        vm.prank(organizer);
        address vaultAddr = factory.createTournament(
            VerdiktFactory.CreateParams({
                name: name,
                arbiters: arbiters,
                threshold: 2,
                prizePool: 10 ether,
                rankBps: bps,
                fundingDuration: 2 days,
                resolutionDuration: 3 days,
                challengeWindow: 120,
                challengeBond: 0.5 ether
            })
        );
        v = PrizePoolVault(vaultAddr);
    }

    function test_createWiresConfigAndAdmin() public {
        PrizePoolVault v = _create("Lagos Winter Cup");

        assertEq(v.admin(), organizer, "caller becomes admin");
        assertEq(v.prizePool(), 10 ether);
        assertEq(v.threshold(), 2);
        assertEq(v.challengeWindow(), 120);
        assertTrue(v.isArbiter(arb1));
        assertTrue(v.isArbiter(arb3));
        assertEq(v.fundingDeadline(), block.timestamp + 2 days);
        assertEq(v.resolutionDeadline(), block.timestamp + 5 days);

        (, address[] memory arbs,,,,,,,) = v.config();
        assertEq(arbs.length, 3);
    }

    function test_registryListsTournaments() public {
        _create("Cup One");
        _create("Cup Two");

        assertEq(factory.count(), 2);
        VerdiktFactory.TournamentInfo[] memory infos = factory.all();
        assertEq(infos.length, 2);
        assertEq(infos[0].name, "Cup One");
        assertEq(infos[1].name, "Cup Two");
        assertEq(infos[0].organizer, organizer);

        VerdiktFactory.TournamentInfo[] memory p = factory.page(1, 5);
        assertEq(p.length, 1);
        assertEq(p[0].name, "Cup Two");
    }

    function test_distinctTournamentIds() public {
        PrizePoolVault a = _create("Same Name");
        PrizePoolVault b = _create("Same Name");
        assertTrue(a.tournamentId() != b.tournamentId(), "ids must differ even for same name");
    }

    /// A factory-made vault runs the full happy path — organizer powers intact.
    function test_factoryVaultFullLifecycle() public {
        PrizePoolVault v = _create("E2E Cup");

        vm.startPrank(organizer);
        v.registerParticipant("p1", player);
        v.registerParticipant("p2", makeAddr("p2"));
        v.registerParticipant("p3", makeAddr("p3"));
        v.deposit{value: 10 ether}();
        v.goLive();
        vm.stopPrank();
        assertEq(uint8(v.state()), uint8(PrizePoolVault.State.Live));

        // 2-of-2-known-keys attestation (arb3 stays silent — M-of-N tolerance)
        address[] memory ranked = new address[](3);
        ranked[0] = player;
        ranked[1] = v.participantWallet("p2");
        ranked[2] = v.participantWallet("p3");
        bytes32 digest = v.resultDigest(ranked, 0);

        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(arbPk1, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(arbPk2, digest);
        bytes memory sigA = abi.encodePacked(r1, s1, v1);
        bytes memory sigB = abi.encodePacked(r2, s2, v2);
        if (arb1 < arb2) {
            sigs[0] = sigA;
            sigs[1] = sigB;
        } else {
            sigs[0] = sigB;
            sigs[1] = sigA;
        }

        v.proposeResult(ranked, sigs);
        assertEq(v.claim(player), 6 ether);

        vm.warp(block.timestamp + 121);
        v.finalize();
        uint256 before = player.balance;
        vm.prank(player);
        v.withdraw();
        assertEq(player.balance - before, 6 ether);
    }
}
