// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrizePoolVault} from "./PrizePoolVault.sol";

/// @title VerdiktFactory — self-service competition creation
/// @notice Anyone can spin up a tournament: one call deploys a fresh PrizePoolVault
///         with the caller as organizer (admin). The factory keeps an on-chain
///         registry so UIs can list every tournament ever created.
/// @dev The factory holds no funds and has no owner — it is pure deployment logic.
///      Each vault's rules (judges, split, deadlines) are frozen by its own
///      constructor; the factory adds nothing an organizer could abuse.
contract VerdiktFactory {
    struct TournamentInfo {
        address vault;
        address organizer;
        uint64 createdAt;
        string name;
    }

    TournamentInfo[] private _tournaments;

    event TournamentCreated(
        address indexed vault, address indexed organizer, uint256 index, string name
    );

    /// @notice Parameters for a new tournament (struct keeps the EVM stack shallow).
    struct CreateParams {
        string name; // display name (registry + event)
        address[] arbiters; // judge wallets (vault enforces M > N/2)
        uint256 threshold; // required signatures (M)
        uint256 prizePool; // exact pool to lock, 18-dec native USDC
        uint16[] rankBps; // payout table, index 0 = 1st; must sum to 10_000
        uint256 fundingDuration; // seconds from now to fully fund + go live
        uint256 resolutionDuration; // seconds after funding deadline for a result
        uint256 challengeWindow; // dispute window duration, seconds
        uint256 challengeBond; // stake required to raise a dispute
    }

    /// @notice Deploy a new tournament vault. msg.sender becomes its admin.
    function createTournament(CreateParams calldata p) external returns (address vault) {
        // Unique per (name, organizer, index, chain) — feeds the EIP-712 domain scope.
        bytes32 tournamentId =
            keccak256(abi.encode(p.name, msg.sender, _tournaments.length, block.chainid));

        vault = address(
            new PrizePoolVault({
                _admin: msg.sender,
                arbiters: p.arbiters,
                _threshold: p.threshold,
                _tournamentId: tournamentId,
                _prizePool: p.prizePool,
                rankBps_: p.rankBps,
                _fundingDeadline: block.timestamp + p.fundingDuration,
                _resolutionDeadline: block.timestamp + p.fundingDuration + p.resolutionDuration,
                _challengeWindow: p.challengeWindow,
                _challengeBond: p.challengeBond
            })
        );

        TournamentInfo storage t = _tournaments.push();
        t.vault = vault;
        t.organizer = msg.sender;
        t.createdAt = uint64(block.timestamp);
        t.name = p.name;
        emit TournamentCreated(vault, msg.sender, _tournaments.length - 1, p.name);
    }

    function count() external view returns (uint256) {
        return _tournaments.length;
    }

    /// @notice Full registry in one eth_call. Fine at demo/regional scale; a paginated
    ///         reader exists below for when the list grows.
    function all() external view returns (TournamentInfo[] memory) {
        return _tournaments;
    }

    function page(uint256 offset, uint256 limit)
        external
        view
        returns (TournamentInfo[] memory out)
    {
        uint256 n = _tournaments.length;
        if (offset >= n) return new TournamentInfo[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new TournamentInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = _tournaments[i];
        }
    }
}
