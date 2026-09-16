// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// AUDIT REGRESSIONS — these were the PoCs for audit findings H-1/ARC-02 and
// M-1/ARC-01 (see ArcGG-audit-report.md). Inverted after the fix: the attacks
// must now FAIL, and stay failing forever.
import {Test} from "forge-std/Test.sol";
import {PrizePoolVault} from "../src/PrizePoolVault.sol";

contract AuditPoC is Test {
    PrizePoolVault vault;

    address admin = makeAddr("admin");
    address sponsor = makeAddr("sponsor");
    uint256 arbPk1 = 0xA11CE;
    uint256 arbPk2 = 0xB0B;
    address arb1;
    address arb2;
    address arb3 = makeAddr("arb3");
    address p1 = makeAddr("player1");
    address p2 = makeAddr("player2");
    address p3 = makeAddr("player3");

    uint256 constant POOL = 100 ether;
    uint256 constant BOND = 1 ether;
    uint256 constant WINDOW = 48 hours;

    function setUp() public {
        arb1 = vm.addr(arbPk1);
        arb2 = vm.addr(arbPk2);
        address[] memory arbs = new address[](3);
        arbs[0] = arb1;
        arbs[1] = arb2;
        arbs[2] = arb3;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000;
        bps[1] = 3000;
        bps[2] = 1000;

        vault = new PrizePoolVault(
            admin, arbs, 2, bytes32("audit"), POOL, bps,
            block.timestamp + 2 days, block.timestamp + 5 days, WINDOW, BOND
        );

        vm.deal(sponsor, POOL);
        vm.deal(p1, 10 ether);
        vm.deal(p2, 10 ether);
        vm.deal(p3, 10 ether);

        vm.startPrank(admin);
        vault.registerParticipant("p1", p1);
        vault.registerParticipant("p2", p2);
        vault.registerParticipant("p3", p3);
        vm.stopPrank();
        vm.prank(sponsor);
        vault.deposit{value: POOL}();
        vm.prank(admin);
        vault.goLive();
    }

    function _ranking(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _sign2(address[] memory ranked, uint256 round) internal view returns (bytes[] memory sigs) {
        bytes32 digest = vault.resultDigest(ranked, round);
        uint256 pkLo = vm.addr(arbPk1) < vm.addr(arbPk2) ? arbPk1 : arbPk2;
        uint256 pkHi = pkLo == arbPk1 ? arbPk2 : arbPk1;
        sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pkLo, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pkHi, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);
    }

    /// F-1 — A loser can nuke a FINAL result into full cancellation.
    /// After MAX_RE_RESOLUTIONS is exhausted, challenge() still accepts a new
    /// challenge; reResolve() can never run; the deadline valve then cancels the
    /// tournament: winners lose everything, depositors are refunded, and the
    /// griefer gets their bond back. Anti-griefing economics are fully bypassed.
    function test_F1_thirdChallengeForcesCancellation() public {
        address[] memory rk = _ranking(p1, p2, p3);

        vault.proposeResult(rk, _sign2(rk, 0));

        // Two unfounded challenges by the sore loser p3 burn MAX_RE_RESOLUTIONS.
        vm.prank(p3);
        vault.challenge{value: BOND}();
        vault.reResolve(rk, _sign2(rk, 1)); // identical ranking -> unfounded, bond -> p1's claim

        vm.prank(p3);
        vault.challenge{value: BOND}();
        vault.reResolve(rk, _sign2(rk, 2)); // unfounded again

        // FIXED: the third challenge itself now reverts — the result is FINAL.
        vm.prank(p3);
        vm.expectRevert(PrizePoolVault.TooManyReResolutions.selector);
        vault.challenge{value: BOND}();

        // The final result survives: window closes, winner withdraws.
        vm.warp(block.timestamp + WINDOW + 1);
        vault.finalize();
        vm.prank(p1);
        vault.withdraw();
        assertGe(p1.balance, 60 ether, "winner paid despite the griefing attempts");
    }

    /// F-2 — An unfounded-challenge bond folded into a claim is ORPHANED by the
    /// next _clearClaims(): the wei stays in the contract with no accounting
    /// entry pointing at it. "Not one wei lost" invariant broken.
    function test_F2_unfoundedBondOrphanedByClear() public {
        address[] memory rk = _ranking(p1, p2, p3);
        address[] memory rk2 = _ranking(p2, p1, p3);

        vault.proposeResult(rk, _sign2(rk, 0));

        // Challenge #1: unfounded -> bond folded into p1's claim (61 = 60 + 1).
        vm.prank(p3);
        vault.challenge{value: BOND}();
        vault.reResolve(rk, _sign2(rk, 1));
        // FIXED: compensation goes through the pull channel, not the mutable claim.
        assertEq(vault.claim(p1), 60 ether, "claim holds prize only");
        assertEq(vault.bondRefund(p1), BOND, "compensation in the surviving channel");

        // Challenge #2: FOUNDED (ranking changes) -> _clearClaims() wipes
        // p1's claim INCLUDING the folded bond, then reallocates only POOL.
        vm.prank(p2);
        vault.challenge{value: BOND}();
        vault.reResolve(rk2, _sign2(rk2, 2));

        // Everyone exits cleanly.
        vm.warp(block.timestamp + WINDOW + 1);
        vault.finalize();
        vm.prank(p1);
        vault.withdraw();
        vm.prank(p2);
        vault.withdraw();
        vm.prank(p3);
        vault.withdraw();
        vm.prank(p2);
        vault.claimBondRefund(); // founded challenge -> bond #2 back
        vm.prank(p1);
        vault.claimBondRefund(); // FIXED: delayed ex-winner pulls their compensation

        // Vault is Closed and NOT ONE WEI is stranded.
        assertEq(uint8(vault.state()), uint8(PrizePoolVault.State.Closed));
        assertEq(vault.unclaimedTotal(), 0);
        assertEq(address(vault).balance, 0, "not one wei lost");
    }

    /// ARC-03 — duplicate wallets across ranks are a signing mistake: rejected.
    function test_R3_duplicateRankedWalletRejected() public {
        address[] memory rk = _ranking(p1, p1, p3);
        bytes[] memory sigs = _sign2(rk, 0);
        vm.expectRevert(PrizePoolVault.DuplicateWinner.selector);
        vault.proposeResult(rk, sigs);
    }

    /// ARC-04 — once Live, not even the admin can abort before the deadline.
    function test_R4_adminCannotCancelLiveEarly() public {
        vm.prank(admin);
        vm.expectRevert(PrizePoolVault.CancelNotAllowed.selector);
        vault.cancel("changed my mind");
    }

    /// ARC-05 — degenerate configs are rejected at construction.
    function test_R5_constructorBounds() public {
        address[] memory arbs = new address[](3);
        arbs[0] = arb1;
        arbs[1] = arb2;
        arbs[2] = arb3;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 6000;
        bps[1] = 3000;
        bps[2] = 1000;

        // zero bond
        vm.expectRevert(PrizePoolVault.BadConfig.selector);
        new PrizePoolVault(admin, arbs, 2, bytes32("x"), POOL, bps,
            block.timestamp + 1 days, block.timestamp + 2 days, WINDOW, 0);

        // zero-bps rank
        uint16[] memory bpsZero = new uint16[](3);
        bpsZero[0] = 9000;
        bpsZero[1] = 1000;
        bpsZero[2] = 0;
        vm.expectRevert(PrizePoolVault.BadConfig.selector);
        new PrizePoolVault(admin, arbs, 2, bytes32("x"), POOL, bpsZero,
            block.timestamp + 1 days, block.timestamp + 2 days, WINDOW, BOND);

        // more than 8 paid places
        uint16[] memory bps9 = new uint16[](9);
        for (uint256 i = 0; i < 9; i++) bps9[i] = i == 0 ? 1200 : 1100;
        vm.expectRevert(PrizePoolVault.BadConfig.selector);
        new PrizePoolVault(admin, arbs, 2, bytes32("x"), POOL, bps9,
            block.timestamp + 1 days, block.timestamp + 2 days, WINDOW, BOND);
    }
}
