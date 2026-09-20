// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ArbiterAttestation — M-of-N signed result attestation (EIP-712)
/// @notice Mixin for PrizePoolVault. A result is valid only if >= threshold arbiters signed it.
/// @dev No trusted relayer: signatures carry the authority, msg.sender only pays gas.
///      Signatures are gathered off-chain, then submitted as a batch.
///
///      Anti-replay, four layers:
///        1. chainId + verifyingContract in the EIP-712 domain (no cross-chain / cross-vault reuse)
///        2. tournamentId in the struct (no cross-tournament reuse between identical vaults)
///        3. rankingHash binds the exact ordered winner list
///        4. round binds each signature bundle to one resolution round (no re-use of the
///           initial result's signatures to push through a fraudulent re-resolution)
abstract contract ArbiterAttestation {
    using ECDSA for bytes32;

    mapping(address => bool) public isArbiter;
    address[] internal _arbiterList; // enumerable copy, for transparency UIs
    uint256 public immutable arbiterCount; // N
    uint256 public immutable threshold; // M (constructor enforces M > N/2)

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant RESULT_TYPEHASH =
        keccak256("Result(bytes32 tournamentId,bytes32 rankingHash,uint256 round)");

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public immutable tournamentId;

    error ZeroThreshold();
    error ThresholdAboveN();
    error ThresholdNotMajority();
    error ZeroArbiter();
    error DuplicateArbiter();
    error SigsUnorderedOrDuplicate();
    error NotAnArbiter();
    error ThresholdNotMet();

    constructor(address[] memory arbiters_, uint256 _threshold, bytes32 _tournamentId) {
        if (_threshold == 0) revert ZeroThreshold();
        if (_threshold > arbiters_.length) revert ThresholdAboveN();
        // Honest-majority policy: a colluding minority can never forge a result.
        if (_threshold * 2 <= arbiters_.length) revert ThresholdNotMajority();

        for (uint256 i = 0; i < arbiters_.length; i++) {
            address a = arbiters_[i];
            if (a == address(0)) revert ZeroArbiter();
            if (isArbiter[a]) revert DuplicateArbiter();
            isArbiter[a] = true;
            _arbiterList.push(a);
        }
        arbiterCount = arbiters_.length;
        threshold = _threshold;
        tournamentId = _tournamentId;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Verdikt PrizePoolVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Reverts unless >= threshold distinct arbiters signed (rankedWallets, round).
    /// @param signatures MUST be ordered by strictly ascending recovered signer address.
    /// @dev Ascending order gives duplicate rejection for free: a repeat signer can never
    ///      be strictly greater than itself, so no seen-signer storage is needed.
    function _verifyResultAttestation(
        address[] calldata rankedWallets,
        uint256 round,
        bytes[] calldata signatures
    ) internal view {
        bytes32 digest = _digest(keccak256(abi.encode(rankedWallets)), round);

        address last = address(0);
        uint256 count;
        for (uint256 i = 0; i < signatures.length; i++) {
            // ECDSA.recover rejects malleable (high-s) signatures and the zero address.
            address signer = digest.recover(signatures[i]);
            if (signer <= last) revert SigsUnorderedOrDuplicate();
            if (!isArbiter[signer]) revert NotAnArbiter();
            last = signer;
            count++;
        }
        if (count < threshold) revert ThresholdNotMet();
    }

    /// @notice The full arbiter set, in registration order. Anyone can inspect the
    ///         judges before depositing a single cent.
    function arbiters() external view returns (address[] memory) {
        return _arbiterList;
    }

    /// @notice The exact digest an arbiter must sign for a given ranking and round.
    /// @dev Exposed for off-chain signers (eth_signTypedData produces the same digest).
    function resultDigest(address[] calldata rankedWallets, uint256 round)
        external
        view
        returns (bytes32)
    {
        return _digest(keccak256(abi.encode(rankedWallets)), round);
    }

    function _digest(bytes32 rankingHash, uint256 round) private view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(RESULT_TYPEHASH, tournamentId, rankingHash, round));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }
}
