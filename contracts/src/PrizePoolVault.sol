// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArbiterAttestation} from "./ArbiterAttestation.sol";
import {RankMath} from "./RankMath.sol";

/// @title PrizePoolVault — auto-arbitrated esports prize pool on Arc
/// @notice Sponsors lock native USDC upfront; results settle instantly into LOCKED claims;
///         winners withdraw only after a clean challenge window. Organizers can never run
///         off with the pot, and "paid then disqualified" is structurally impossible.
///
/// @dev Native-first design: all value moves via msg.value / call{value:} on Arc's
///      18-decimal native USDC. The 6-decimal ERC-20 interface at 0x3600...0000 is
///      deliberately never touched (mixing the two is a silent 10^12 discrepancy).
///
///      State machine:
///        Created -> Funded -> Live -> ResultProposed -> Withdrawable -> Closed
///        ResultProposed -> Challenged -> ResultProposed   (bounded loop)
///        {Created, Funded, Live, Challenged} -> Cancelled (deadline safety valves)
///
///      Money invariants:
///        - sum(claims) + heldBond + refundable deposits == contract balance, always
///        - funds can only ever flow to registered participant wallets (withdraw),
///          back to depositors (refund), or back to the challenger (bond refund).
///          There is NO path to an arbitrary address — not even for the admin.
contract PrizePoolVault is ArbiterAttestation {
    // ─────────────────────────────────────────────────────────────
    // States
    // ─────────────────────────────────────────────────────────────
    enum State {
        Created, // config frozen, collecting deposits
        Funded, // full pool locked
        Live, // roster locked, tournament running
        ResultProposed, // claims allocated, challenge window open
        Challenged, // valid dispute raised, awaiting re-resolution
        Withdrawable, // window elapsed clean, winners may pull
        Closed, // all claims withdrawn — terminal (happy)
        Cancelled // refunds open — terminal (safety valve)
    }

    State public state;

    // ─────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────
    /// @notice Organizer. Can register players, go live, and cancel BEFORE a result
    ///         exists. Can never redirect a payout or cancel once claims are assigned.
    address public immutable admin;

    // ─────────────────────────────────────────────────────────────
    // Config (frozen at construction)
    // ─────────────────────────────────────────────────────────────
    uint256 public immutable prizePool; // exact total to lock, 18-dec native USDC
    uint16[] private _rankBps; // index 0 = 1st place; sums to 10_000
    uint256 public immutable fundingDeadline; // Created/Funded must reach Live before this
    uint256 public immutable resolutionDeadline; // Live must produce a result before this
    uint256 public immutable challengeWindow; // duration of the dispute window
    uint256 public immutable challengeBond; // stake required to raise a dispute

    uint8 public constant MAX_RE_RESOLUTIONS = 2;

    // ─────────────────────────────────────────────────────────────
    // Live accounting
    // ─────────────────────────────────────────────────────────────
    uint256 public deposited;
    mapping(address => uint256) public depositOf;

    mapping(bytes32 => address) public participantWallet;
    bytes32[] private _playerIds; // enumerable roster, for transparency UIs // playerId => payout wallet
    mapping(address => bool) public isParticipantWallet;

    mapping(address => uint256) public claim; // locked until Withdrawable
    uint256 public unclaimedTotal;
    address[] private _winners; // current rank-ordered winners (for clearing)

    uint256 public resolutionRound; // 0 for the first result, +1 per re-resolution
    uint8 public reResolutionCount;
    bytes32 public currentRankingHash;
    uint256 public windowEndsAt; // challenge window close (set per proposal)
    uint256 public reResolveDeadline; // arbiters must re-resolve before this

    address public challenger;
    uint256 public heldBond;
    mapping(address => uint256) public bondRefund; // pull-based bond refunds

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────
    event Deposited(address indexed from, uint256 amount, uint256 total);
    event ParticipantRegistered(bytes32 indexed playerId, address indexed wallet);
    event WentLive(uint256 lockedPool);
    event ResultProposedEvt(uint256 indexed round, bytes32 rankingHash, uint256 windowEndsAt);
    event ChallengeRaised(address indexed by, uint256 bond, uint256 reResolveDeadline);
    event ReResolved(uint256 indexed round, bool challengeFounded, uint256 newWindowEndsAt);
    event BecameWithdrawable();
    event Withdrawn(address indexed to, uint256 amount);
    event VaultClosed();
    event VaultCancelled(string reason);
    event Refunded(address indexed to, uint256 amount);
    event BondRefunded(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────
    error WrongState();
    error NotAdmin();
    error ZeroAmount();
    error Overfunded();
    error ZeroWallet();
    error PlayerTaken();
    error WalletTaken();
    error RankedLengthMismatch();
    error TooFewParticipants();
    error NotRegisteredWinner();
    error DuplicateWinner();
    error DeadlinePassed();
    error WindowClosed();
    error WindowStillOpen();
    error NotParticipant();
    error WrongBond();
    error TooManyReResolutions();
    error NothingToWithdraw();
    error NothingToRefund();
    error TransferFailed();
    error CancelNotAllowed();
    error BadConfig();

    modifier inState(State s) {
        if (state != s) revert WrongState();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address[] memory arbiters,
        uint256 _threshold,
        bytes32 _tournamentId,
        uint256 _prizePool,
        uint16[] memory rankBps_,
        uint256 _fundingDeadline,
        uint256 _resolutionDeadline,
        uint256 _challengeWindow,
        uint256 _challengeBond
    ) ArbiterAttestation(arbiters, _threshold, _tournamentId) {
        if (_admin == address(0)) revert ZeroWallet();
        if (_prizePool == 0) revert ZeroAmount();
        if (rankBps_.length == 0) revert BadConfig();
        if (_fundingDeadline <= block.timestamp) revert BadConfig();
        if (_resolutionDeadline <= _fundingDeadline) revert BadConfig();
        if (_challengeWindow == 0) revert BadConfig();

        uint256 sum;
        for (uint256 i = 0; i < rankBps_.length; i++) {
            sum += rankBps_[i];
        }
        if (sum != 10_000) revert BadConfig();

        admin = _admin;
        prizePool = _prizePool;
        _rankBps = rankBps_;
        fundingDeadline = _fundingDeadline;
        resolutionDeadline = _resolutionDeadline;
        challengeWindow = _challengeWindow;
        challengeBond = _challengeBond;
        // state defaults to Created
    }

    // ─────────────────────────────────────────────────────────────
    // Created -> Funded  (deposits)
    // ─────────────────────────────────────────────────────────────
    /// @notice Deposit native USDC into the pool. Auto-transitions to Funded when full.
    function deposit() external payable inState(State.Created) {
        if (msg.value == 0) revert ZeroAmount();
        if (block.timestamp > fundingDeadline) revert DeadlinePassed();
        if (deposited + msg.value > prizePool) revert Overfunded();

        depositOf[msg.sender] += msg.value;
        deposited += msg.value;
        emit Deposited(msg.sender, msg.value, deposited);

        if (deposited == prizePool) {
            state = State.Funded;
        }
    }

    /// @notice Register a participant's payout wallet BEFORE the tournament goes live.
    /// @dev Kills two failure modes: hand-typed addresses after winning, and post-hoc
    ///      roster edits. Also the allowlist that makes arbitrary-payout impossible.
    function registerParticipant(bytes32 playerId, address wallet) external onlyAdmin {
        if (state != State.Created && state != State.Funded) revert WrongState();
        if (wallet == address(0)) revert ZeroWallet();
        if (participantWallet[playerId] != address(0)) revert PlayerTaken();
        if (isParticipantWallet[wallet]) revert WalletTaken();

        participantWallet[playerId] = wallet;
        isParticipantWallet[wallet] = true;
        _playerIds.push(playerId);
        emit ParticipantRegistered(playerId, wallet);
    }

    // ─────────────────────────────────────────────────────────────
    // Funded -> Live
    // ─────────────────────────────────────────────────────────────
    function goLive() external onlyAdmin inState(State.Funded) {
        if (block.timestamp > fundingDeadline) revert DeadlinePassed();
        // Every paid rank needs a registered player — a podium can't be emptier
        // than the payout table it promises.
        if (_playerIds.length < _rankBps.length) revert TooFewParticipants();
        state = State.Live;
        emit WentLive(prizePool);
    }

    // ─────────────────────────────────────────────────────────────
    // Live -> ResultProposed  (M-of-N attested; the "agent" never pushes funds)
    // ─────────────────────────────────────────────────────────────
    /// @notice Submit the final ranking with >= threshold arbiter signatures (round 0).
    ///         Allocates locked claims and opens the challenge window.
    function proposeResult(address[] calldata rankedWallets, bytes[] calldata signatures)
        external
        inState(State.Live)
    {
        if (block.timestamp > resolutionDeadline) revert DeadlinePassed();
        _verifyResultAttestation(rankedWallets, resolutionRound, signatures);

        _allocateByRank(rankedWallets);
        currentRankingHash = keccak256(abi.encode(rankedWallets));
        windowEndsAt = block.timestamp + challengeWindow;
        state = State.ResultProposed;
        emit ResultProposedEvt(resolutionRound, currentRankingHash, windowEndsAt);
    }

    // ─────────────────────────────────────────────────────────────
    // ResultProposed -> Challenged -> ResultProposed  (bounded loop)
    // ─────────────────────────────────────────────────────────────
    /// @notice Raise a dispute within the window. Costs a bond (anti-griefing).
    /// @dev Only registered participant wallets may challenge — outsiders can't grief.
    function challenge() external payable inState(State.ResultProposed) {
        if (block.timestamp >= windowEndsAt) revert WindowClosed();
        if (!isParticipantWallet[msg.sender]) revert NotParticipant();
        if (msg.value != challengeBond) revert WrongBond();

        challenger = msg.sender;
        heldBond = msg.value;
        reResolveDeadline = block.timestamp + challengeWindow;
        state = State.Challenged;
        emit ChallengeRaised(msg.sender, msg.value, reResolveDeadline);
    }

    /// @notice Arbiters re-resolve with a fresh attestation for the NEXT round.
    /// @dev Bond policy: if the ranking CHANGED, the challenge was founded — the bond
    ///      is refundable to the challenger. If the ranking is identical, the challenge
    ///      was unfounded — the bond is added to the 1st-place claim, compensating the
    ///      winner whose payout the griefer delayed.
    function reResolve(address[] calldata rankedWallets, bytes[] calldata signatures)
        external
        inState(State.Challenged)
    {
        if (block.timestamp > reResolveDeadline) revert DeadlinePassed();
        if (reResolutionCount >= MAX_RE_RESOLUTIONS) revert TooManyReResolutions();
        reResolutionCount++;
        resolutionRound++;
        _verifyResultAttestation(rankedWallets, resolutionRound, signatures);

        bytes32 newHash = keccak256(abi.encode(rankedWallets));
        bool founded = newHash != currentRankingHash;

        _clearClaims();
        _allocateByRank(rankedWallets);

        if (founded) {
            bondRefund[challenger] += heldBond;
        } else {
            // Griefing a winner pays the winner.
            claim[rankedWallets[0]] += heldBond;
            unclaimedTotal += heldBond;
        }
        heldBond = 0;
        challenger = address(0);

        currentRankingHash = newHash;
        windowEndsAt = block.timestamp + challengeWindow;
        state = State.ResultProposed;
        emit ReResolved(resolutionRound, founded, windowEndsAt);
    }

    // ─────────────────────────────────────────────────────────────
    // ResultProposed -> Withdrawable -> Closed
    // ─────────────────────────────────────────────────────────────
    /// @notice Anyone may finalize once the window elapsed with no open dispute.
    function finalize() external inState(State.ResultProposed) {
        if (block.timestamp < windowEndsAt) revert WindowStillOpen();
        state = State.Withdrawable;
        emit BecameWithdrawable();
    }

    /// @notice Winner pulls their claim. Checks-Effects-Interactions; never pushed.
    function withdraw() external inState(State.Withdrawable) {
        uint256 amount = claim[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        claim[msg.sender] = 0; // effect before interaction
        unclaimedTotal -= amount;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);

        if (unclaimedTotal == 0) {
            state = State.Closed;
            emit VaultClosed();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // * -> Cancelled  (the dead-funds safety valves)
    // ─────────────────────────────────────────────────────────────
    /// @notice Cancel and open refunds. Every live state has a time-based exit that
    ///         ANYONE can trigger, so funds can never be frozen forever — even if
    ///         admin and arbiters all vanish.
    /// @dev Admin may cancel early only BEFORE a result exists (Created/Funded/Live).
    ///      Once claims are assigned, only deadline-based cancellation from Challenged
    ///      remains — the admin cannot claw back a won pot.
    function cancel(string calldata reason) external {
        bool allowed;
        if (state == State.Created || state == State.Funded) {
            allowed = msg.sender == admin || block.timestamp > fundingDeadline;
        } else if (state == State.Live) {
            allowed = msg.sender == admin || block.timestamp > resolutionDeadline;
        } else if (state == State.Challenged) {
            allowed = block.timestamp > reResolveDeadline;
        }
        if (!allowed) revert CancelNotAllowed();

        if (challenger != address(0)) {
            bondRefund[challenger] += heldBond;
            heldBond = 0;
            challenger = address(0);
        }
        _clearClaims();
        state = State.Cancelled;
        emit VaultCancelled(reason);
    }

    /// @notice Depositors pull their contribution back after cancellation.
    function refund() external inState(State.Cancelled) {
        uint256 amount = depositOf[msg.sender];
        if (amount == 0) revert NothingToRefund();

        depositOf[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(msg.sender, amount);
    }

    /// @notice Pull a bond refund (founded challenge, or cancellation while challenged).
    function claimBondRefund() external {
        uint256 amount = bondRefund[msg.sender];
        if (amount == 0) revert NothingToRefund();

        bondRefund[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit BondRefunded(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────
    function rankBps() external view returns (uint16[] memory) {
        return _rankBps;
    }

    /// @notice Full vault state in ONE eth_call. Public RPCs rate-limit request
    ///         bursts, so a polling dashboard reads this instead of six getters.
    function snapshot()
        external
        view
        returns (
            State state_,
            uint256 prizePool_,
            uint256 deposited_,
            uint256 windowEndsAt_,
            uint256 challengeBond_,
            uint256 unclaimedTotal_,
            uint256 resolutionRound_
        )
    {
        return (
            state,
            prizePool,
            deposited,
            windowEndsAt,
            challengeBond,
            unclaimedTotal,
            resolutionRound
        );
    }

    /// @notice The full roster in ONE eth_call — every registered player and the
    ///         exact wallet their prize can reach. Locked before play; public always.
    function participants()
        external
        view
        returns (bytes32[] memory ids, address[] memory wallets)
    {
        ids = _playerIds;
        wallets = new address[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            wallets[i] = participantWallet[ids[i]];
        }
    }

    /// @notice The full tournament configuration in ONE eth_call — the judges, the
    ///         split, the deadlines, the bond. Committed at deployment, immutable, and
    ///         inspectable by anyone BEFORE they deposit. Trust nothing; verify here.
    function config()
        external
        view
        returns (
            address admin_,
            address[] memory arbiters_,
            uint256 threshold_,
            uint16[] memory rankBps_,
            uint256 prizePool_,
            uint256 fundingDeadline_,
            uint256 resolutionDeadline_,
            uint256 challengeWindow_,
            uint256 challengeBond_
        )
    {
        return (
            admin,
            _arbiterList,
            threshold,
            _rankBps,
            prizePool,
            fundingDeadline,
            resolutionDeadline,
            challengeWindow,
            challengeBond
        );
    }

    /// @notice Everything the UI shows for one wallet, in ONE eth_call.
    function snapshotFor(address who)
        external
        view
        returns (uint256 claim_, uint256 bondRefund_, uint256 depositOf_)
    {
        return (claim[who], bondRefund[who], depositOf[who]);
    }

    function winners() external view returns (address[] memory) {
        return _winners;
    }

    // ─────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────
    /// @dev Fills `claim` so that the newly allocated amounts sum to prizePool EXACTLY
    ///      (RankMath folds integer-division dust into rank 0). Every winner must be a
    ///      registered participant wallet — arbiters cannot pay arbitrary addresses.
    function _allocateByRank(address[] calldata rankedWallets) internal {
        uint256 n = _rankBps.length;
        if (rankedWallets.length != n) revert RankedLengthMismatch();

        uint256[] memory parts = RankMath.computeParts(prizePool, _rankBps);

        uint256 allocated;
        for (uint256 i = 0; i < n; i++) {
            address w = rankedWallets[i];
            if (!isParticipantWallet[w]) revert NotRegisteredWinner();
            // One wallet, one podium place. A real match can't rank the same
            // player twice — a duplicate is a signing mistake, not a ranking.
            for (uint256 j = 0; j < i; j++) {
                if (rankedWallets[j] == w) revert DuplicateWinner();
            }
            claim[w] += parts[i];
            allocated += parts[i];
            _winners.push(w);
        }
        unclaimedTotal += allocated;

        // Not one wei created or lost. If this ever trips, halt hard.
        assert(allocated == prizePool);
    }

    /// @dev Zero out the current allocation before re-allocation or cancellation.
    function _clearClaims() internal {
        uint256 n = _winners.length;
        for (uint256 i = 0; i < n; i++) {
            delete claim[_winners[i]];
        }
        delete _winners;
        unclaimedTotal = 0;
    }
}
