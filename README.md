# ArcGG — GG, get paid.

Self-service, trustless prize pools for esports tournaments on [Arc](https://arc.io),
Circle's stablecoin-native L1. Anyone can create a tournament in one transaction;
sponsors lock USDC upfront, results settle instantly into locked claims, winners
withdraw after a clean challenge window.

**Track:** DeFi · Programmable Money Hackathon — Build on Arc (Encode, 2026)
**Live demo:** https://arcgg-ten.vercel.app · **Video:** https://youtu.be/QJ-VZyUYPXg

## The problem

In grassroots esports — especially across Africa's fast-growing competitive scene — prize
money runs on trust. Organizers collect entry fees and sponsor money off-chain, and winners
chase payouts for weeks. Sometimes the money never comes. The pattern is so common it has
a name in every community: *the organizer ran off with the pot.*

## The solution

ArcGG replaces "trust the organizer" with a state-machine vault on Arc:

1. **Anyone can spin up a tournament.** One transaction on the ArcGGFactory deploys a
   dedicated vault; the creator becomes the organizer, and an on-chain registry lists
   every tournament. Prize splits are configurable (1–8 paid places, presets matching
   how African tournaments actually pay — IESF 2024: top-3, 50/30/20).
2. **The pot is locked before play begins.** Deposits are visible on-chain; the tournament
   can't go live until the pool is fully funded and every paid rank has a registered
   player. Nobody can spend it — not even the admin.
3. **Results are attested, not declared.** An M-of-N judge set signs the final ranking
   (EIP-712, 4-layer replay protection). No single trusted party can forge a result, and
   one judge can vanish without blocking anything.
4. **Settlement is instant, withdrawal is safe.** Claims are allocated the second a result
   lands — but locked behind a challenge window. Disputes resolve *before* any money
   leaves the contract. "Paid then disqualified" is structurally impossible.
5. **Funds can never be frozen.** Every live state has a deadline valve anyone can
   trigger — one button in the UI — cancelling the tournament and opening refunds if the
   organizer or judges vanish.

Everything is inspectable in-app before anyone deposits a cent: judges, roster, split,
deadlines. ArcGG doesn't make organizers honest — it makes them inspectable.

## State machine

```
Created ──► Funded ──► Live ──► ResultProposed ──► Withdrawable ──► Closed
                                   ▲       │
                                   │       ▼
                                └─ Challenged        (bounded re-resolution loop)

{Created, Funded, Live, Challenged} ──deadline──► Cancelled ──► refunds (pull)
```

Key mechanics:

- **Locked claims + challenge window** — instant settlement without irreversible mistakes.
- **M-of-N EIP-712 attestation** — signatures bind to `(chainId, vault, tournamentId,
  rankingHash, round)`; a round-0 signature can never validate a re-resolution.
- **Challenge bond** — disputes cost a stake. Founded challenge: bond refunded. Unfounded:
  the bond compensates the delayed winner. Griefing a winner pays the winner.
- **Pull payments only** — funds can only ever reach registered participant wallets,
  depositors (refunds), or the challenger (bond). There is no code path to an arbitrary
  address, not even for the admin.
- **Exact accounting** — `RankMath` splits the pool by rank with integer-division dust
  folded into 1st place; `sum(claims) == prizePool` is fuzz-proven for any rank table.
- **Single-call reads** — `snapshot()`, `snapshotFor()`, `config()`, `participants()`
  return whole views in one `eth_call` each, keeping the dashboard friendly to
  rate-limited public RPCs.

## Why Arc, specifically

- **Native USDC gas & settlement** — the prize asset *is* the gas asset; sub-second
  finality makes "match ends → pot moves" feel instant on stream.
- **Native-first design** — all value moves via `msg.value` on Arc's 18-decimal native
  USDC. The 6-decimal ERC-20 interface at `0x3600...0000` is deliberately never touched:
  mixing the two conventions is a silent 10^12 discrepancy, treated here as a first-class
  design constraint.
- **Built for the real world** — a same-origin RPC proxy (de-batching, spacing, caching,
  retry) handles the public RPC's CORS and burst limits. It runs on the internet, not
  just localhost.

## Deployed

**Arc Testnet** (chain 5042002):

- **ArcGGFactory (main entry point)** — create your own tournament:
  [`0xd01F9Fda58f6AecD303664E4f320152f077810c2`](https://testnet.arcscan.app/address/0xd01F9Fda58f6AecD303664E4f320152f077810c2)
- Example tournament vault (the one from the demo video):
  [`0x5EbeC44aF0E4EdCbB6Dc43bec32a262A0BadCF81`](https://testnet.arcscan.app/address/0x5EbeC44aF0E4EdCbB6Dc43bec32a262A0BadCF81)
- Earlier standalone deployments (pre-factory, kept for history):
  [`0xbCAce0C49cf272786005217BbE457196F73AB628`](https://testnet.arcscan.app/address/0xbCAce0C49cf272786005217BbE457196F73AB628) ·
  [`0x12e780a6636Ca12520D5eF6e8933632877FdF453`](https://testnet.arcscan.app/address/0x12e780a6636Ca12520D5eF6e8933632877FdF453)

## Repository layout

```
contracts/   Foundry project (Solidity 0.8.24, OpenZeppelin v5.6)
  src/       ArcGGFactory.sol · PrizePoolVault.sol · ArbiterAttestation.sol · RankMath.sol
  test/      29 tests: state machine, bond mechanics, replay protection, fuzz invariants
  script/    Deploy.s.sol · DeployFactory.s.sol (Arc testnet, env-required params)
app/         Next.js + Viem + Wagmi frontend — landing + create form, live state rail,
             organizer/participants/rules panels, deadline countdowns, same-origin RPC proxy
demo/        Arbiter EIP-712 signing script + scene-by-scene demo runbook
```

## Run it

```bash
cd contracts
forge install          # forge-std + openzeppelin-contracts v5.6
forge build
forge test             # 29 tests incl. 512-run fuzz on the payout invariant
```

Deploy your own factory to Arc testnet ([faucet](https://faucet.circle.com), chain id `5042002`):

```bash
cp .env.example .env   # TESTNET-ONLY private key + demo params
source .env
forge script script/DeployFactory.s.sol --rpc-url arc_testnet --broadcast
```

Run the frontend:

```bash
cd app
npm install
npm run dev            # http://localhost:3000 — landing, create, and tournament views
```

## Status

- [x] Vault state machine + M-of-N EIP-712 attestation — 29/29 tests green
- [x] Self-service factory with on-chain tournament registry
- [x] Transparency by default: judges, roster, splits, deadline valves — inspectable in-app
- [x] Full lifecycle verified on Arc Testnet with real 2-of-3 signatures
- [x] Live deployment (Vercel) + 3-min demo video + deck
- [ ] Next: in-app judge signing, team prize splitting, arbiter reputation registry,
      pilot with a real African tournament organizer

## License

MIT
