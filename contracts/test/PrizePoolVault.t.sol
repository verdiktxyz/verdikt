// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrizePoolVault} from "../src/PrizePoolVault.sol";
import {ArbiterAttestation} from "../src/ArbiterAttestation.sol";

contract PrizePoolVaultTest is Test {
    PrizePoolVault vault;

    address admin = makeAddr("admin");
    address sponsor1 = makeAddr("sponsor1");
    address sponsor2 = makeAddr("sponsor2");

    // Arbiters as known private keys so we can produce real ECDSA signatures.
    uint256 arbPk1 = 0xA11CE;
    uint256 arbPk2 = 0xB0B;
    uint256 arbPk3 = 0xCA11;
    address arb1;
    address arb2;
    address arb3;

    address p1 = makeAddr("player1");
    address p2 = makeAddr("player2");
    address p3 = makeAddr("player3");
    address p4 = makeAddr("player4");
    address outsider = makeAddr("outsider");

    uint256 constant POOL = 100 ether; // 100 native USDC (18 dec)
    uint256 constant BOND = 1 ether;
    uint256 constant WINDOW = 48 hours;

    uint256 fundingDeadline;
    uint256 resolutionDeadline;

    function setUp() public {
        arb1 = vm.addr(arbPk1);
        arb2 = vm.addr(arbPk2);
        arb3 = vm.addr(arbPk3);

        fundingDeadline = block.timestamp + 1 days;
        resolutionDeadline = block.timestamp + 3 days;

        address[] memory arbiters = new address[](3);
        arbiters[0] = arb1;
        arbiters[1] = arb2;
        arbiters[2] = arb3;

        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000;
        bps[1] = 3000;
        bps[2] = 1000;

        vault = new PrizePoolVault(
            admin,
            arbiters,
            2, // 2-of-3
            keccak256("ARCGG_TEST_TOURNAMENT"),
            POOL,
            bps,
            fundingDeadline,
            resolutionDeadline,
            WINDOW,
            BOND
        );

        vm.deal(sponsor1, 1000 ether);
        vm.deal(sponsor2, 1000 ether);
        vm.deal(p1, 10 ether);
        vm.deal(p2, 10 ether);
        vm.deal(p3, 10 ether);
        vm.deal(outsider, 10 ether);
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────
    function _fund() internal {
        vm.prank(sponsor1);
        vault.deposit{value: 60 ether}();
        vm.prank(sponsor2);
        vault.deposit{value: 40 ether}();
    }

    function _register() internal {
        vm.startPrank(admin);
        vault.registerParticipant("p1", p1);
        vault.registerParticipant("p2", p2);
        vault.registerParticipant("p3", p3);
        vault.registerParticipant("p4", p4);
        vm.stopPrank();
    }

    function _goLive() internal {
        _fund();
        _register();
        vm.prank(admin);
        vault.goLive();
    }

    function _ranking(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    /// Sign `ranked` for `round` with the given arbiter keys, sorted by signer address.
    function _sign(address[] memory ranked, uint256 round, uint256[] memory pks)
        internal
        view
        returns (bytes[] memory sigs)
    {
        // calldata-compatible digest: use the vault's own view
        address[] memory m = ranked;
        bytes32 digest = vault.resultDigest(_toCalldata(m), round);

        // sort pks by derived address (tiny n, bubble is fine)
        for (uint256 i = 0; i < pks.length; i++) {
            for (uint256 j = i + 1; j < pks.length; j++) {
                if (vm.addr(pks[i]) > vm.addr(pks[j])) {
                    (pks[i], pks[j]) = (pks[j], pks[i]);
                }
            }
        }
        sigs = new bytes[](pks.length);
        for (uint256 i = 0; i < pks.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    // resultDigest takes calldata; passing memory through an external self-call keeps types happy
    function _toCalldata(address[] memory m) internal pure returns (address[] memory) {
        return m;
    }

    function _twoSigs() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = 0xA11CE;
        pks[1] = 0xB0B;
    }

    function _propose(address[] memory ranked) internal {
        bytes[] memory sigs = _sign(ranked, vault.resolutionRound(), _twoSigs());
        vault.proposeResult(_toCalldata(ranked), sigs);
    }

    // ─────────────────────────────────────────────────────────────
    // Happy path
    // ─────────────────────────────────────────────────────────────
    function test_happyPath_fullLifecycle() public {
        _goLive();
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Live));

        address[] memory ranked = _ranking(p1, p2, p3);
        _propose(ranked);
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.ResultProposed));

        // claims allocated but NOT withdrawable yet — "paid then disqualified" impossible
        assertEq(vault.claim(p1), 60 ether);
        assertEq(vault.claim(p2), 30 ether);
        assertEq(vault.claim(p3), 10 ether);
        vm.prank(p1);
        vm.expectRevert(PrizePoolVault.WrongState.selector);
        vault.withdraw();

        vm.warp(block.timestamp + WINDOW);
        vault.finalize();
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Withdrawable));

        uint256 p1Before = p1.balance;
        vm.prank(p1);
        vault.withdraw();
        assertEq(p1.balance - p1Before, 60 ether);

        vm.prank(p2);
        vault.withdraw();
        vm.prank(p3);
        vault.withdraw();

        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Closed));
        assertEq(address(vault).balance, 0); // not one wei stranded
    }

    function test_depositOverfundReverts() public {
        vm.prank(sponsor1);
        vm.expectRevert(PrizePoolVault.Overfunded.selector);
        vault.deposit{value: POOL + 1}();
    }

    function test_goLiveRequiresFullFunding() public {
        vm.prank(sponsor1);
        vault.deposit{value: 60 ether}();
        vm.prank(admin);
        vm.expectRevert(PrizePoolVault.WrongState.selector); // still Created
        vault.goLive();
    }

    // ─────────────────────────────────────────────────────────────
    // Attestation guards
    // ─────────────────────────────────────────────────────────────
    function test_thresholdNotMetReverts() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        uint256[] memory onePk = new uint256[](1);
        onePk[0] = arbPk1;
        bytes[] memory sigs = _sign(ranked, 0, onePk);

        vm.expectRevert(ArbiterAttestation.ThresholdNotMet.selector);
        vault.proposeResult(_toCalldata(ranked), sigs);
    }

    function test_duplicateSignerReverts() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        uint256[] memory pks = new uint256[](2);
        pks[0] = arbPk1;
        pks[1] = arbPk1; // same arbiter twice
        bytes[] memory sigs = _sign(ranked, 0, pks);

        vm.expectRevert(ArbiterAttestation.SigsUnorderedOrDuplicate.selector);
        vault.proposeResult(_toCalldata(ranked), sigs);
    }

    function test_nonArbiterSignerReverts() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        uint256[] memory pks = new uint256[](2);
        pks[0] = arbPk1;
        pks[1] = 0xDEAD; // not an arbiter
        bytes[] memory sigs = _sign(ranked, 0, pks);

        vm.expectRevert(ArbiterAttestation.NotAnArbiter.selector);
        vault.proposeResult(_toCalldata(ranked), sigs);
    }

    function test_unregisteredWinnerReverts() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, outsider); // outsider not registered
        bytes[] memory sigs = _sign(ranked, 0, _twoSigs());

        vm.expectRevert(PrizePoolVault.NotRegisteredWinner.selector);
        vault.proposeResult(_toCalldata(ranked), sigs);
    }

    /// Round binding: round-0 signatures can never validate a round-1 re-resolution.
    function test_crossRoundReplayReverts() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        bytes[] memory round0Sigs = _sign(ranked, 0, _twoSigs());
        vault.proposeResult(_toCalldata(ranked), round0Sigs);

        vm.prank(p2);
        vault.challenge{value: BOND}();

        // replay the SAME round-0 bundle for the re-resolution (round is now 1)
        vm.expectRevert(); // recovered signers won't match arbiters / threshold
        vault.reResolve(_toCalldata(ranked), round0Sigs);
    }

    // ─────────────────────────────────────────────────────────────
    // Challenge & bond mechanics
    // ─────────────────────────────────────────────────────────────
    function test_challengeGuards() public {
        _goLive();
        _propose(_ranking(p1, p2, p3));

        // outsider cannot challenge
        vm.prank(outsider);
        vm.expectRevert(PrizePoolVault.NotParticipant.selector);
        vault.challenge{value: BOND}();

        // wrong bond
        vm.prank(p2);
        vm.expectRevert(PrizePoolVault.WrongBond.selector);
        vault.challenge{value: BOND - 1}();

        // after window closes
        vm.warp(block.timestamp + WINDOW);
        vm.prank(p2);
        vm.expectRevert(PrizePoolVault.WindowClosed.selector);
        vault.challenge{value: BOND}();
    }

    /// Founded challenge: ranking changes -> challenger gets the bond back.
    function test_foundedChallenge_refundsBond_andReallocates() public {
        _goLive();
        _propose(_ranking(p1, p2, p3));

        vm.prank(p2);
        vault.challenge{value: BOND}();
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Challenged));

        // arbiters re-resolve with a DIFFERENT ranking (p1 disqualified: p2 now 1st)
        address[] memory corrected = _ranking(p2, p3, p4);
        bytes[] memory sigs = _sign(corrected, 1, _twoSigs());
        vault.reResolve(_toCalldata(corrected), sigs);

        // old claims cleared, new ones set
        assertEq(vault.claim(p1), 0);
        assertEq(vault.claim(p2), 60 ether);
        assertEq(vault.claim(p3), 30 ether);
        assertEq(vault.claim(p4), 10 ether);

        // bond refundable to challenger (pull)
        assertEq(vault.bondRefund(p2), BOND);
        uint256 before = p2.balance;
        vm.prank(p2);
        vault.claimBondRefund();
        assertEq(p2.balance - before, BOND);

        // fresh window reopened
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.ResultProposed));
    }

    /// Unfounded challenge: same ranking re-attested -> bond compensates 1st place.
    function test_unfoundedChallenge_bondGoesToWinner() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        _propose(ranked);

        vm.prank(p2);
        vault.challenge{value: BOND}();

        bytes[] memory sigs = _sign(ranked, 1, _twoSigs());
        vault.reResolve(_toCalldata(ranked), sigs);

        assertEq(vault.claim(p1), 60 ether); // prize untouched by the bond
        assertEq(vault.bondRefund(p1), BOND); // griefing a winner pays the winner — pull channel
        assertEq(vault.bondRefund(p2), 0);

        // full drain still balances to zero
        vm.warp(block.timestamp + WINDOW);
        vault.finalize();
        vm.prank(p1);
        vault.withdraw();
        vm.prank(p2);
        vault.withdraw();
        vm.prank(p3);
        vault.withdraw();
        vm.prank(p1);
        vault.claimBondRefund(); // compensation pulled separately from the prize
        assertEq(address(vault).balance, 0);
    }

    function test_reResolutionLoopIsBounded() public {
        _goLive();
        address[] memory ranked = _ranking(p1, p2, p3);
        _propose(ranked);

        // challenge #1 -> reResolve #1
        vm.prank(p2);
        vault.challenge{value: BOND}();
        vault.reResolve(_toCalldata(ranked), _sign(ranked, 1, _twoSigs()));

        // challenge #2 -> reResolve #2
        vm.prank(p3);
        vault.challenge{value: BOND}();
        vault.reResolve(_toCalldata(ranked), _sign(ranked, 2, _twoSigs()));

        // challenge #3 must revert AT THE DOOR: with re-resolutions exhausted,
        // the standing result is final (audit H-1 fix).
        vm.prank(p2);
        vm.expectRevert(PrizePoolVault.TooManyReResolutions.selector);
        vault.challenge{value: BOND}();

        // and the final result is finalizable, not cancellable-by-griefer
        vm.warp(block.timestamp + WINDOW + 1);
        vault.finalize();
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Withdrawable));
    }

    // ─────────────────────────────────────────────────────────────
    // Deadlines & refunds (the anti-dead-funds valves)
    // ─────────────────────────────────────────────────────────────
    function test_fundingDeadline_anyoneCancels_refundsFlow() public {
        vm.prank(sponsor1);
        vault.deposit{value: 60 ether}(); // partial funding, then organizer vanishes

        vm.warp(fundingDeadline + 1);
        vm.prank(outsider); // ANYONE can trigger the valve
        vault.cancel("never funded");

        uint256 before = sponsor1.balance;
        vm.prank(sponsor1);
        vault.refund();
        assertEq(sponsor1.balance - before, 60 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_resolutionDeadline_liveTournamentAbandoned() public {
        _goLive();
        vm.warp(resolutionDeadline + 1);

        vm.prank(outsider);
        vault.cancel("no result ever came");

        vm.prank(sponsor1);
        vault.refund();
        vm.prank(sponsor2);
        vault.refund();
        assertEq(address(vault).balance, 0);
    }

    function test_challengedDeadline_bondReturnsOnCancel() public {
        _goLive();
        _propose(_ranking(p1, p2, p3));
        vm.prank(p2);
        vault.challenge{value: BOND}();

        // arbiters never re-resolve
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(outsider);
        vault.cancel("arbiters vanished");

        // challenger recovers the bond, depositors their funds
        vm.prank(p2);
        vault.claimBondRefund();
        vm.prank(sponsor1);
        vault.refund();
        vm.prank(sponsor2);
        vault.refund();
        assertEq(address(vault).balance, 0);
    }

    /// The admin can never claw back a pot once a result exists.
    function test_adminCannotCancelAfterResult() public {
        _goLive();
        _propose(_ranking(p1, p2, p3));

        vm.prank(admin);
        vm.expectRevert(PrizePoolVault.CancelNotAllowed.selector);
        vault.cancel("rug attempt");

        // nor while challenged (deadline not yet passed)
        vm.prank(p2);
        vault.challenge{value: BOND}();
        vm.prank(admin);
        vm.expectRevert(PrizePoolVault.CancelNotAllowed.selector);
        vault.cancel("rug attempt 2");
    }

    function test_cannotCancelWithdrawable() public {
        _goLive();
        _propose(_ranking(p1, p2, p3));
        vm.warp(block.timestamp + WINDOW);
        vault.finalize();

        vm.prank(admin);
        vm.expectRevert(PrizePoolVault.CancelNotAllowed.selector);
        vault.cancel("too late");
    }

    // ─────────────────────────────────────────────────────────────
    // Aggregate views (single-eth_call reads for the frontend)
    // ─────────────────────────────────────────────────────────────
    function test_snapshotViewsMatchGetters() public {
        _fund();
        _register();

        (
            PrizePoolVault.State s,
            uint256 pool,
            uint256 dep,
            ,
            uint256 bond,
            uint256 unclaimed,
            uint256 round
        ) = vault.snapshot();
        assertEq(uint8(s), uint8(vault.state()));
        assertEq(pool, POOL);
        assertEq(dep, POOL);
        assertEq(bond, BOND);
        assertEq(unclaimed, 0);
        assertEq(round, 0);

        vm.prank(admin);
        vault.goLive();
        _propose(_ranking(p1, p2, p3));

        (s, , , , , unclaimed, ) = vault.snapshot();
        assertEq(uint8(s), uint8(PrizePoolVault.State.ResultProposed));
        assertEq(unclaimed, POOL);

        (uint256 c, uint256 br, uint256 d) = vault.snapshotFor(p1);
        assertEq(c, vault.claim(p1));
        assertEq(br, 0);
        assertEq(d, 0);
        (c, br, d) = vault.snapshotFor(sponsor1);
        assertEq(d, 60 ether);
    }

    function test_configExposesJudgesAndRules() public view {
        (
            address admin_,
            address[] memory arbs,
            uint256 thr,
            uint16[] memory bps,
            uint256 pool,
            uint256 fd,
            uint256 rd,
            uint256 cw,
            uint256 cb
        ) = vault.config();
        assertEq(admin_, admin);
        assertEq(arbs.length, 3);
        assertEq(arbs[0], arb1);
        assertEq(arbs[1], arb2);
        assertEq(arbs[2], arb3);
        assertEq(thr, 2);
        assertEq(bps.length, 3);
        assertEq(uint256(bps[0]), 6000);
        assertEq(pool, POOL);
        assertEq(fd, fundingDeadline);
        assertEq(rd, resolutionDeadline);
        assertEq(cw, WINDOW);
        assertEq(cb, BOND);
    }

    function test_participantsViewListsRoster() public {
        _register();
        (bytes32[] memory ids, address[] memory wallets) = vault.participants();
        assertEq(ids.length, 4);
        assertEq(wallets.length, 4);
        assertEq(ids[0], bytes32("p1"));
        assertEq(wallets[0], p1);
        assertEq(ids[3], bytes32("p4"));
        assertEq(wallets[3], p4);
    }

    function test_goLiveRequiresEnoughParticipants() public {
        _fund();
        vm.startPrank(admin);
        vault.registerParticipant("only1", p1);
        vault.registerParticipant("only2", p2);
        vm.expectRevert(PrizePoolVault.TooFewParticipants.selector);
        vault.goLive();
        // third player fills the podium — now it can start
        vault.registerParticipant("only3", p3);
        vault.goLive();
        vm.stopPrank();
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Live));
    }
}
