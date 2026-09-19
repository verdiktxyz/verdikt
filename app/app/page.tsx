"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSignTypedData,
  usePublicClient,
} from "wagmi";
import { parseEther, isAddress, getAddress, stringToHex, hexToString, decodeEventLog, keccak256, encodeAbiParameters, hashTypedData, recoverTypedDataAddress } from "viem";
import { arcTestnet } from "@/lib/chain";
import { vaultAbi } from "@/lib/abi";
import { FACTORY_ADDRESS, factoryAbi } from "@/lib/factory";
import { STATES, RAIL, type VaultState } from "@/lib/vault";
import { fmtUsdc, shortAddr } from "@/lib/format";

type VaultRef = { address: `0x${string}`; abi: typeof vaultAbi };

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Indeterminate progress bar shown while a transaction is confirming. */
function TxProgress({ label }: { label: string }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-ink">
        <div className="h-full w-1/3 animate-tx-slide rounded-full bg-gradient-to-r from-violet to-cyan" />
      </div>
      <p className="mt-1.5 text-xs text-mut">{label}</p>
    </div>
  );
}

/** Active vault from ?vault=… — undefined while parsing, null on the landing page. */
function useVaultAddress(): `0x${string}` | null | undefined {
  const [addr, setAddr] = useState<`0x${string}` | null | undefined>(undefined);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("vault");
    setAddr(p && isAddress(p) ? getAddress(p) : null);
  }, []);
  return addr;
}

// ─────────────────────────────────────────────────────────────
// Page shell
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const vaultAddr = useVaultAddress();

  return (
    <main className="mx-auto max-w-5xl px-5 pb-20">
      <TopBar showHome={!!vaultAddr} />
      {vaultAddr === undefined && (
        <p className="mt-10 text-center text-sm text-mut">Loading…</p>
      )}
      {vaultAddr === null && <Landing />}
      {vaultAddr && (
        <TournamentView vault={{ address: vaultAddr, abi: vaultAbi }} />
      )}
    </main>
  );
}

function TopBar({ showHome }: { showHome: boolean }) {
  const mounted = useMounted();
  const { address, isConnected: connected } = useAccount();
  const isConnected = mounted && connected;
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="flex items-center justify-between py-6">
      <div className="flex items-baseline gap-3">
        <a href="/" className="no-underline">
          <span className="text-2xl font-bold text-white">Verd</span>
          <span className="text-2xl font-bold text-cyan">ikt</span>
        </a>
        <span className="hidden text-xs tracking-[0.25em] text-mut sm:inline">
          THE JURY SIGNS. THE MONEY MOVES.
        </span>
        {showHome && (
          <a href="/" className="ml-2 text-xs text-mut hover:text-cyan">
            ← all competitions
          </a>
        )}
      </div>
      {isConnected && address ? (
        <button
          onClick={() => disconnect()}
          className="rounded-lg border border-edge bg-card px-4 py-2 text-sm text-mut hover:text-white"
          title="Disconnect"
        >
          {shortAddr(address)}
        </button>
      ) : (
        <button
          onClick={() =>
            connect({ connector: connectors[0], chainId: arcTestnet.id })
          }
          className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold hover:opacity-90"
        >
          Connect wallet
        </button>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Landing — tournament registry + self-service creation
// ─────────────────────────────────────────────────────────────
const factory = { address: FACTORY_ADDRESS, abi: factoryAbi } as const;
const FACTORY_UNSET =
  (FACTORY_ADDRESS as string) === "0x0000000000000000000000000000000000000000";

function Landing() {
  return (
    <>
      <section className="rounded-2xl border border-edge bg-card p-6">
        <h1 className="text-xl font-bold text-white">
          Trustless prize pools for any competition
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-mut">
          Hackathons, tournaments, design contests, bounties — anywhere a jury
          decides who gets paid. Sponsors lock USDC upfront, judges attest the
          result M-of-N, winners withdraw after a clean challenge window. Every
          rule is committed on-chain, inspectable before anyone deposits a cent.
        </p>
      </section>
      <TournamentList />
      <CreateTournament />
    </>
  );
}

function TournamentList() {
  const mounted = useMounted();
  const { data: infos } = useReadContract({
    ...factory,
    functionName: "all",
    query: { enabled: !FACTORY_UNSET, refetchInterval: 30000 },
  });

  return (
    <section className="mt-5 rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        COMPETITIONS
      </h2>
      {FACTORY_UNSET ? (
        <p className="mt-3 text-sm text-mut">
          Factory not deployed yet — set FACTORY_ADDRESS in lib/factory.ts.
        </p>
      ) : !mounted || !infos ? (
        <p className="mt-3 text-sm text-mut">Loading competitions…</p>
      ) : infos.length === 0 ? (
        <p className="mt-3 text-sm text-mut">
          No competitions yet. Create the first one below.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-edge">
          {[...infos].reverse().map((t) => (
            <li key={t.vault}>
              <a
                href={`/?vault=${t.vault}`}
                className="flex items-center justify-between py-3 hover:bg-ink/40"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{t.name}</p>
                  <p className="text-xs text-mut">
                    by {shortAddr(t.organizer)} ·{" "}
                    {new Date(Number(t.createdAt) * 1000).toLocaleDateString(
                      "en-GB",
                      { day: "2-digit", month: "short" },
                    )}
                  </p>
                </div>
                <span className="font-display text-xs text-cyan">
                  {shortAddr(t.vault)} →
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SPLIT_PRESETS: Record<string, number[]> = {
  "Top 3 — 60 / 30 / 10": [6000, 3000, 1000],
  "Top 3 — 50 / 30 / 20": [5000, 3000, 2000],
  "Top 4 — 50 / 25 / 15 / 10": [5000, 2500, 1500, 1000],
};

function CreateTournament() {
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const [name, setName] = useState("");
  const [pool, setPool] = useState("10");
  const [arb1, setArb1] = useState("");
  const [arb2, setArb2] = useState("");
  const [arb3, setArb3] = useState("");
  const [preset, setPreset] = useState(Object.keys(SPLIT_PRESETS)[0]);
  const [pcts, setPcts] = useState<string[]>(["60", "30", "10"]);

  function applyPreset(name: string) {
    setPreset(name);
    const bps = SPLIT_PRESETS[name];
    if (bps) setPcts(bps.map((b) => String(b / 100)));
  }
  function setPlaces(nRaw: string) {
    const n = Math.max(1, Math.min(8, Math.round(Number(nRaw) || 0)));
    setPreset("Custom");
    setPcts((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("0");
      return next;
    });
  }
  function setPct(i: number, v: string) {
    setPreset("Custom");
    setPcts((prev) => prev.map((p, j) => (j === i ? v : p)));
  }
  const bpsFromPcts = pcts.map((p) => Math.round(Number(p || "0") * 100));
  const bpsSum = bpsFromPcts.reduce((a, b) => a + b, 0);
  const [fundingDays, setFundingDays] = useState("2");
  const [resolutionDays, setResolutionDays] = useState("3");
  const [windowMin, setWindowMin] = useState("2880"); // 48h default
  const [bond, setBond] = useState("0.5");
  const [formError, setFormError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, data: receipt } = useWaitForTransactionReceipt({ hash });

  // On success: pull the new vault address out of the TournamentCreated event.
  useEffect(() => {
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: factoryAbi, ...log });
        if (ev.eventName === "TournamentCreated") {
          window.location.href = `/?vault=${(ev.args as { vault: string }).vault}`;
          return;
        }
      } catch {
        /* not our event */
      }
    }
  }, [receipt]);

  function submit() {
    setFormError(null);
    const arbs = [arb1, arb2, arb3].map((a) => a.trim());
    if (!name.trim()) return setFormError("Give the tournament a name.");
    for (const a of arbs) {
      if (!isAddress(a)) return setFormError(`Invalid judge address: ${a || "(empty)"}`);
    }
    if (new Set(arbs.map((a) => a.toLowerCase())).size !== 3)
      return setFormError("Judges must be three distinct addresses.");
    if (bpsFromPcts.some((b) => b <= 0))
      return setFormError("Every paid place needs a share above 0%.");
    if (bpsSum !== 10000)
      return setFormError(
        `Prize shares must sum to exactly 100% (currently ${bpsSum / 100}%).`,
      );

    writeContract({
      ...factory,
      functionName: "createTournament",
      chainId: arcTestnet.id,
      args: [
        {
          name: name.trim(),
          arbiters: arbs.map((a) => getAddress(a)),
          threshold: 2n,
          prizePool: parseEther(pool),
          rankBps: bpsFromPcts,
          fundingDuration: BigInt(Math.round(Number(fundingDays) * 86400)),
          resolutionDuration: BigInt(Math.round(Number(resolutionDays) * 86400)),
          challengeWindow: BigInt(Math.round(Number(windowMin) * 60)),
          challengeBond: parseEther(bond),
        },
      ],
    });
  }

  const field =
    "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-violet";

  return (
    <section className="mt-5 rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        CREATE A COMPETITION
      </h2>
      <p className="mt-2 text-sm text-mut">
        One transaction deploys a dedicated vault. You become the organizer —
        but the judges, the split and the deadlines are frozen the moment it
        exists. You can never touch the pot.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="text-xs text-mut">Competition name</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos Winter Cup / Hackathon Dakar 2026" />
        </div>
        <div>
          <label className="text-xs text-mut">Prize pool (USDC)</label>
          <input className={field} value={pool} onChange={(e) => setPool(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="text-xs text-mut">Prize split preset</label>
          <select
            className={field}
            value={preset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {Object.keys(SPLIT_PRESETS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
            <option value="Custom">Custom…</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <div className="flex items-end gap-3">
            <div>
              <label className="text-xs text-mut">Paid places (1–8)</label>
              <input
                className={field + " w-24"}
                value={String(pcts.length)}
                onChange={(e) => setPlaces(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <p className={"pb-2 text-xs " + (bpsSum === 10000 ? "text-cyan" : "text-danger")}>
              Total: {bpsSum / 100}% {bpsSum === 10000 ? "✓" : "— must be exactly 100%"}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 md:grid-cols-8">
            {pcts.map((p, i) => (
              <div key={i}>
                <label className="text-xs text-mut">
                  {i + 1}
                  {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"} %
                </label>
                <input
                  className={field}
                  value={p}
                  onChange={(e) => setPct(i, e.target.value)}
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-mut">
            Judges (arbiters) — 3 wallets, 2 signatures required to attest results.
            Independent from paid places. Pick people your community already
            trusts; the list can never change.
          </label>
          <div className="mt-1 grid gap-2 md:grid-cols-3">
            <input className={field} value={arb1} onChange={(e) => setArb1(e.target.value)} placeholder="0x… judge 1" />
            <input className={field} value={arb2} onChange={(e) => setArb2(e.target.value)} placeholder="0x… judge 2" />
            <input className={field} value={arb3} onChange={(e) => setArb3(e.target.value)} placeholder="0x… judge 3" />
          </div>
        </div>
        <div>
          <label className="text-xs text-mut">Funding period (days)</label>
          <input className={field} value={fundingDays} onChange={(e) => setFundingDays(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="text-xs text-mut">Play period (days)</label>
          <input className={field} value={resolutionDays} onChange={(e) => setResolutionDays(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="text-xs text-mut">Challenge window (minutes)</label>
          <input className={field} value={windowMin} onChange={(e) => setWindowMin(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="text-xs text-mut">Challenge bond (USDC)</label>
          <input className={field} value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <button
        disabled={FACTORY_UNSET || !mounted || !isConnected || isPending || isLoading}
        onClick={submit}
        className="mt-4 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
      >
        {isPending || isLoading ? "Creating…" : "Create competition"}
      </button>
      {!FACTORY_UNSET && mounted && !isConnected && (
        <p className="mt-2 text-xs text-mut">Connect a wallet to create.</p>
      )}
      {isPending && <TxProgress label="Confirm in your wallet…" />}
      {isLoading && <TxProgress label="Deploying your vault on Arc…" />}
      {(formError || error) && (
        <p className="mt-2 text-xs text-danger">
          {formError ??
            ((error as { shortMessage?: string })?.shortMessage || error?.message)}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Tournament view — one vault
// ─────────────────────────────────────────────────────────────
function TournamentView({ vault }: { vault: VaultRef }) {
  const mounted = useMounted();
  const { address, isConnected } = useAccount();

  // One eth_call for the whole vault state (public RPCs rate-limit bursts).
  const { data: snap, refetch } = useReadContract({
    ...vault,
    functionName: "snapshot",
    query: { refetchInterval: 15000 },
  });

  const state = snap !== undefined ? Number(snap[0]) : undefined;
  const prizePool = (snap?.[1] as bigint | undefined) ?? 0n;
  const deposited = (snap?.[2] as bigint | undefined) ?? 0n;
  const windowEndsAt = (snap?.[3] as bigint | undefined) ?? 0n;
  const unclaimedTotal = (snap?.[5] as bigint | undefined) ?? 0n;
  const resolutionRound = (snap?.[6] as bigint | undefined) ?? 0n;

  const stateName: VaultState | undefined =
    state !== undefined ? STATES[state] : undefined;

  return (
    <>
      <StateRail current={stateName} />

      <div className="mt-6 grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <VaultPanel
          vault={vault}
          stateName={stateName}
          prizePool={prizePool}
          deposited={deposited}
          windowEndsAt={windowEndsAt}
          unclaimedTotal={unclaimedTotal}
          onChanged={refetch}
        />
        <div className="flex flex-col gap-5">
          <SponsorPanel
            vault={vault}
            enabled={mounted && stateName === "Created" && isConnected}
            stateName={stateName}
            remaining={prizePool - deposited}
            onChanged={refetch}
          />
          <WinnerPanel
            vault={vault}
            address={address}
            stateName={stateName}
            onChanged={refetch}
          />
        </div>
      </div>

      <AdminPanel vault={vault} stateName={stateName} onChanged={refetch} />
      <JudgePanel
        vault={vault}
        stateName={stateName}
        resolutionRound={resolutionRound}
        onChanged={refetch}
      />
      <ParticipantsPanel vault={vault} />
      <RulesPanel vault={vault} />

      <footer className="mt-10 text-center text-xs text-mut">
        Vault{" "}
        <a
          className="text-cyan hover:underline"
          href={`${arcTestnet.blockExplorers.default.url}/address/${vault.address}`}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddr(vault.address)}
        </a>{" "}
        on Arc Testnet · native USDC, 18 decimals · every state change is public
      </footer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Signature element: the state rail — the contract's state machine, live
// ─────────────────────────────────────────────────────────────
function StateRail({ current }: { current?: VaultState }) {
  const offRail = current === "Challenged" || current === "Cancelled";
  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {RAIL.map((s, i) => {
          const active = s === current;
          return (
            <div key={s} className="flex items-center gap-2">
              <span
                className={
                  "rounded-lg px-3 py-1.5 text-xs font-semibold " +
                  (active ? "bg-cyan text-ink" : "border border-edge text-mut")
                }
              >
                {s}
              </span>
              {i < RAIL.length - 1 && <span className="text-edge">→</span>}
            </div>
          );
        })}
        {offRail && (
          <span className="ml-2 rounded-lg border border-danger px-3 py-1.5 text-xs font-semibold text-danger">
            {current}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-mut">
        {current === undefined && "Reading vault state…"}
        {current === "Created" && "Collecting deposits. The tournament can't start until the pool is fully funded."}
        {current === "Funded" && "Pool locked in full. Waiting for the organizer to lock the roster and go live."}
        {current === "Live" && "Tournament running. The pot is locked — nobody can touch it, not even the admin."}
        {current === "ResultProposed" && "Result attested by the arbiters. Claims are allocated but locked until the challenge window closes."}
        {current === "Challenged" && "A participant disputed the result. Arbiters must re-resolve before the deadline."}
        {current === "Withdrawable" && "Challenge window closed clean. Winners can withdraw their claims."}
        {current === "Closed" && "All prizes withdrawn. Not one wei left behind. GG."}
        {current === "Cancelled" && "Tournament cancelled. Depositors can pull their refunds below."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vault panel — the money, made visible
// ─────────────────────────────────────────────────────────────
function VaultPanel({
  vault,
  stateName,
  prizePool,
  deposited,
  windowEndsAt,
  unclaimedTotal,
  onChanged,
}: {
  vault: VaultRef;
  stateName?: VaultState;
  prizePool: bigint;
  deposited: bigint;
  windowEndsAt: bigint;
  unclaimedTotal: bigint;
  onChanged: () => void;
}) {
  const pct = prizePool > 0n ? Number((deposited * 100n) / prizePool) : 0;

  return (
    <section className="rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        PRIZE POOL
      </h2>
      <p className="mt-2 font-display text-5xl font-bold text-white">
        {fmtUsdc(prizePool)} <span className="text-xl text-cyan">USDC</span>
      </p>

      <div className="mt-5">
        <div className="flex justify-between text-xs text-mut">
          <span>Funded</span>
          <span>
            {fmtUsdc(deposited)} / {fmtUsdc(prizePool)} USDC
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet to-cyan transition-all"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      <DeadlineCountdown vault={vault} stateName={stateName} />

      {stateName === "ResultProposed" && (
        <ChallengeCountdown
          vault={vault}
          windowEndsAt={windowEndsAt}
          onElapsed={onChanged}
        />
      )}

      {(stateName === "Withdrawable" || stateName === "Closed") && (
        <p className="mt-5 text-sm text-mut">
          Unclaimed:{" "}
          <span className="font-display text-white">
            {fmtUsdc(unclaimedTotal)} USDC
          </span>
        </p>
      )}
    </section>
  );
}

/** Live countdown to the state's deadline valve — the "never frozen" guarantee, visible. */
function DeadlineCountdown({
  vault,
  stateName,
}: {
  vault: VaultRef;
  stateName?: VaultState;
}) {
  const { data: cfg } = useReadContract({
    ...vault,
    functionName: "config",
    query: { staleTime: Infinity },
  });
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (!cfg || now === null || !stateName) return null;

  let target: bigint | null = null;
  let label = "";
  let hint = "";
  if (stateName === "Created" || stateName === "Funded") {
    target = cfg[5]; // fundingDeadline
    label = "FUNDING CLOSES IN";
    hint = "Pool must be funded and live by then — past it, anyone can cancel and refunds open.";
  } else if (stateName === "Live" || stateName === "Challenged") {
    target = cfg[6]; // resolutionDeadline
    label = "RESULT DUE IN";
    hint = "Judges must deliver a result by then — past it, anyone can cancel and refunds open.";
  }
  if (target === null) return null;

  const left = Number(target) - now;
  if (left <= 0) {
    return <DeadlineCancel vault={vault} />;
  }

  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const clock =
    (d > 0 ? `${d}d ` : "") +
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return (
    <div className="mt-5 rounded-xl border border-edge bg-ink p-4">
      <p className="text-xs tracking-[0.2em] text-mut">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-white">{clock}</p>
      <p className="mt-1 text-xs text-mut">{hint}</p>
    </div>
  );
}

/** Shown once a deadline valve is open: the promise "anyone can cancel" as a button. */
function DeadlineCancel({ vault }: { vault: VaultRef }) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  return (
    <div className="mt-5 rounded-xl border border-danger/50 bg-ink p-4">
      <p className="text-sm text-danger">
        Deadline passed — anyone can now cancel this tournament and open
        refunds.
      </p>
      <button
        disabled={isPending || isLoading || isSuccess}
        onClick={() =>
          writeContract({
            ...vault,
            functionName: "cancel",
            args: ["deadline passed"],
            chainId: arcTestnet.id,
          })
        }
        className="mt-2 rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger hover:text-ink disabled:opacity-50"
      >
        {isPending || isLoading
          ? "Cancelling…"
          : isSuccess
            ? "Cancelled — refunds open below"
            : "Cancel & open refunds"}
      </button>
      {isPending && <TxProgress label="Confirm in your wallet…" />}
      {isLoading && <TxProgress label="Cancelling — waiting for confirmation…" />}
      {error && (
        <p className="mt-2 text-xs text-danger">
          {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      )}
    </div>
  );
}

function ChallengeCountdown({
  vault,
  windowEndsAt,
  onElapsed,
}: {
  vault: VaultRef;
  windowEndsAt: bigint;
  onElapsed: () => void;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (isSuccess) onElapsed();
  }, [isSuccess, onElapsed]);

  if (now === null) return null;
  const end = Number(windowEndsAt);
  const left = end - now;

  if (left <= 0) {
    return (
      <div className="mt-5 rounded-xl border border-edge bg-ink p-4">
        <p className="text-sm text-mut">
          Challenge window closed. Anyone can finalize:
        </p>
        <button
          onClick={() =>
            writeContract({
              ...vault,
              functionName: "finalize",
              chainId: arcTestnet.id,
            })
          }
          disabled={isPending}
          className="mt-2 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Finalizing…" : "Finalize → Withdrawable"}
        </button>
      </div>
    );
  }

  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <div className="mt-5 rounded-xl border border-edge bg-ink p-4">
      <p className="text-xs tracking-[0.2em] text-mut">CHALLENGE WINDOW</p>
      <p className="mt-1 font-display text-3xl font-bold text-violet">
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:
        {String(s).padStart(2, "0")}
      </p>
      <p className="mt-1 text-xs text-mut">
        Claims are locked until the window closes. Disqualifications happen
        here — before any money moves.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sponsor panel — deposit native USDC
// ─────────────────────────────────────────────────────────────
function SponsorPanel({
  vault,
  enabled,
  stateName,
  remaining,
  onChanged,
}: {
  vault: VaultRef;
  enabled: boolean;
  stateName?: VaultState;
  remaining: bigint;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("1");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      setConfirmed(amount);
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, onChanged]);

  return (
    <section className="rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        SPONSOR
      </h2>
      <p className="mt-2 text-sm text-mut">
        Fund the pot with native USDC. Deposits lock on-chain — visible to
        every player before the first match.
      </p>
      <div className="mt-4 flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="w-24 rounded-lg border border-edge bg-ink px-3 py-2 font-display text-sm outline-none focus:border-violet"
          aria-label="Amount in USDC"
        />
        <button
          disabled={!enabled || isPending || isLoading}
          onClick={() =>
            writeContract({
              ...vault,
              functionName: "deposit",
              value: parseEther(amount),
              chainId: arcTestnet.id,
            })
          }
          className="flex-1 rounded-lg bg-violet px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          {isPending || isLoading ? "Depositing…" : "Deposit USDC"}
        </button>
      </div>
      {isPending && <TxProgress label="Confirm the deposit in your wallet…" />}
      {isLoading && (
        <TxProgress label="Depositing — waiting for on-chain confirmation…" />
      )}
      {isSuccess && confirmed && !isPending && !isLoading && (
        <div className="mt-3 rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
          ✓ Deposited {confirmed} USDC — locked in the pool.
        </div>
      )}
      {stateName === "Created" && (
        <p className="mt-2 text-xs text-mut">
          {fmtUsdc(remaining)} USDC still needed to fully fund the pool.
        </p>
      )}
      {!enabled && stateName !== "Created" && (
        <p className="mt-2 text-xs text-mut">
          Deposits are only open while the vault is in Created.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-danger">
          {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Winner panel — locked claim, then withdraw
// ─────────────────────────────────────────────────────────────
function WinnerPanel({
  vault,
  address,
  stateName,
  onChanged,
}: {
  vault: VaultRef;
  address?: `0x${string}`;
  stateName?: VaultState;
  onChanged: () => void;
}) {
  const mounted = useMounted();
  // One eth_call for everything this wallet can claim/reclaim/refund.
  const { data: mine } = useReadContract({
    ...vault,
    functionName: "snapshotFor",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [paidOut, setPaidOut] = useState<string | null>(null);
  useEffect(() => {
    if (isSuccess) onChanged();
  }, [isSuccess, onChanged]);

  const myClaim = (mine?.[0] as bigint | undefined) ?? 0n;
  const myBond = (mine?.[1] as bigint | undefined) ?? 0n;
  const myDeposit = (mine?.[2] as bigint | undefined) ?? 0n;
  const canWithdraw = stateName === "Withdrawable" && myClaim > 0n;
  const canRefund = stateName === "Cancelled" && myDeposit > 0n;

  return (
    <section className="rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        YOUR CLAIM
      </h2>
      {!mounted || !address ? (
        <p className="mt-2 text-sm text-mut">
          Connect your wallet to see your claim.
        </p>
      ) : (
        <>
          <p className="mt-2 font-display text-4xl font-bold">
            {fmtUsdc(myClaim)} <span className="text-lg text-cyan">USDC</span>
          </p>
          {myClaim > 0n && stateName === "ResultProposed" && (
            <p className="mt-1 text-xs text-mut">
              Allocated — locked until the challenge window closes.
            </p>
          )}
          <button
            disabled={!canWithdraw || isPending || isLoading}
            onClick={() => {
              setPaidOut(fmtUsdc(myClaim));
              writeContract({
                ...vault,
                functionName: "withdraw",
                chainId: arcTestnet.id,
              });
            }}
            className="mt-4 w-full rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-40"
          >
            {isPending || isLoading
              ? "Withdrawing…"
              : canWithdraw
                ? "Withdraw prize"
                : "Withdraw (opens in Withdrawable)"}
          </button>

          {isPending && <TxProgress label="Confirm in your wallet…" />}
          {isLoading && (
            <TxProgress label="Withdrawing — waiting for confirmation…" />
          )}
          {isSuccess && paidOut && !isPending && !isLoading && (
            <div className="mt-3 rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
              ✓ GG — {paidOut} USDC paid out to your wallet.
            </div>
          )}

          {myBond > 0n && (
            <button
              disabled={isPending || isLoading}
              onClick={() =>
                writeContract({
                  ...vault,
                  functionName: "claimBondRefund",
                  chainId: arcTestnet.id,
                })
              }
              className="mt-2 w-full rounded-lg border border-edge px-4 py-2 text-sm text-white hover:border-violet"
            >
              Reclaim challenge bond ({fmtUsdc(myBond)} USDC)
            </button>
          )}

          {canRefund && (
            <button
              disabled={isPending || isLoading}
              onClick={() =>
                writeContract({
                  ...vault,
                  functionName: "refund",
                  chainId: arcTestnet.id,
                })
              }
              className="mt-2 w-full rounded-lg border border-edge px-4 py-2 text-sm text-white hover:border-violet"
            >
              Refund deposit ({fmtUsdc(myDeposit)} USDC)
            </button>
          )}
          {error && (
            <p className="mt-2 text-xs text-danger">
              {(error as { shortMessage?: string }).shortMessage ??
                error.message}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Admin panel — organizer actions, only visible to the admin wallet
// ─────────────────────────────────────────────────────────────
function AdminPanel({
  vault,
  stateName,
  onChanged,
}: {
  vault: VaultRef;
  stateName?: VaultState;
  onChanged: () => void;
}) {
  const mounted = useMounted();
  const { address } = useAccount();
  const { data: cfg } = useReadContract({
    ...vault,
    functionName: "config",
    query: { staleTime: Infinity },
  });
  const { data: roster } = useReadContract({
    ...vault,
    functionName: "participants",
    query: { refetchInterval: 15000 },
  });
  const ranksNeeded = cfg ? cfg[3].length : 0;
  const playersHave = roster ? roster[0].length : 0;
  const rosterShort = playersHave < ranksNeeded;

  const [playerName, setPlayerName] = useState("");
  const [playerWallet, setPlayerWallet] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [lastRegistered, setLastRegistered] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (isSuccess) {
      setLastRegistered(playerName || null);
      setPlayerName("");
      setPlayerWallet("");
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, onChanged]);

  const isAdmin =
    mounted && !!address && !!cfg && address.toLowerCase() === cfg[0].toLowerCase();
  const registrationOpen = stateName === "Created" || stateName === "Funded";
  if (!isAdmin || !registrationOpen) return null;

  const field =
    "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-violet";

  function register() {
    setFormError(null);
    if (!playerName.trim()) return setFormError("Player name required.");
    if (!isAddress(playerWallet.trim()))
      return setFormError("Invalid player wallet address.");
    writeContract({
      ...vault,
      functionName: "registerParticipant",
      chainId: arcTestnet.id,
      args: [
        stringToHex(playerName.trim().slice(0, 31), { size: 32 }),
        getAddress(playerWallet.trim()),
      ],
    });
  }

  return (
    <section className="mt-5 rounded-2xl border border-violet/40 bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-violet">
        ORGANIZER — {stateName === "Funded" ? "roster & kickoff" : "roster"}
      </h2>

      {registrationOpen && (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          <input className={field} value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Player tag (e.g. alice)" />
          <input className={field} value={playerWallet} onChange={(e) => setPlayerWallet(e.target.value)} placeholder="0x… payout wallet" />
          <button
            disabled={isPending || isLoading}
            onClick={register}
            className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {isPending || isLoading ? "Registering…" : "Register player"}
          </button>
        </div>
      )}
      {isSuccess && lastRegistered && !isPending && !isLoading && (
        <p className="mt-2 text-xs text-cyan">
          ✓ {lastRegistered} registered — wallet locked before play.
        </p>
      )}

      {stateName === "Funded" && (
        <div className="mt-4 border-t border-edge pt-4">
          <p className="text-sm text-mut">
            {rosterShort
              ? `${playersHave}/${ranksNeeded} players registered — every paid rank needs a player before the tournament can start.`
              : "Pool fully funded. Lock the roster and start the tournament:"}
          </p>
          <button
            disabled={rosterShort || isPending || isLoading}
            onClick={() =>
              writeContract({
                ...vault,
                functionName: "goLive",
                chainId: arcTestnet.id,
              })
            }
            className="mt-2 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-40"
          >
            Go live →
          </button>
        </div>
      )}

      {(formError || error) && (
        <p className="mt-2 text-xs text-danger">
          {formError ??
            ((error as { shortMessage?: string })?.shortMessage || error?.message)}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Judges' bench — sign the result in MetaMask, relay it on-chain.
// Mirrors ArbiterAttestation.sol exactly: same domain, same Result type,
// so an in-app signature and a script signature are indistinguishable.
// ─────────────────────────────────────────────────────────────
const RESULT_TYPES = {
  Result: [
    { name: "tournamentId", type: "bytes32" },
    { name: "rankingHash", type: "bytes32" },
    { name: "round", type: "uint256" },
  ],
} as const;

function resultTypedData(
  vaultAddr: `0x${string}`,
  tournamentId: `0x${string}`,
  ranked: `0x${string}`[],
  round: bigint,
) {
  return {
    domain: {
      name: "Verdikt PrizePoolVault",
      version: "1",
      chainId: arcTestnet.id,
      verifyingContract: vaultAddr,
    },
    types: RESULT_TYPES,
    primaryType: "Result" as const,
    message: {
      tournamentId,
      rankingHash: keccak256(
        encodeAbiParameters([{ type: "address[]" }], [ranked]),
      ),
      round,
    },
  } as const;
}

type SigPackage = {
  verdikt: number;
  vault: string;
  round: string;
  ranked: string[];
  signer: string;
  sig: `0x${string}`;
};

function JudgePanel({
  vault,
  stateName,
  resolutionRound,
  onChanged,
}: {
  vault: VaultRef;
  stateName?: VaultState;
  resolutionRound: bigint;
  onChanged: () => void;
}) {
  const mounted = useMounted();
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const { data: cfg } = useReadContract({
    ...vault,
    functionName: "config",
    query: { staleTime: Infinity },
  });
  const { data: tid } = useReadContract({
    ...vault,
    functionName: "tournamentId",
    query: { staleTime: Infinity },
  });
  const { data: roster } = useReadContract({
    ...vault,
    functionName: "participants",
    query: { refetchInterval: 30000 },
  });

  const active = stateName === "Live" || stateName === "Challenged";
  const arbiters = useMemo(
    () => (cfg ? cfg[1].map((a) => a.toLowerCase()) : []),
    [cfg],
  );
  const threshold = cfg ? Number(cfg[2]) : 0;
  const ranks = cfg ? cfg[3].length : 0;
  const isJudge =
    mounted && !!address && arbiters.includes(address.toLowerCase());
  // A Challenged re-resolution signs for the NEXT round (reResolve increments first).
  const signRound =
    stateName === "Challenged" ? resolutionRound + 1n : resolutionRound;

  const [rankSel, setRankSel] = useState<string[]>([]);
  useEffect(() => {
    setRankSel((prev) =>
      prev.length === ranks ? prev : Array(ranks).fill(""),
    );
  }, [ranks]);

  const [signError, setSignError] = useState<string | null>(null);
  const [myPackage, setMyPackage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();

  const [pasted, setPasted] = useState("");
  const [collect, setCollect] = useState<{
    ranked: `0x${string}`[] | null;
    sigs: { signer: string; sig: `0x${string}` }[];
    errors: string[];
  }>({ ranked: null, sigs: [], errors: [] });

  const {
    writeContract,
    data: hash,
    isPending: submitting,
    error: submitError,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: submitted } =
    useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (submitted) onChanged();
  }, [submitted, onChanged]);

  // Validate pasted signature packages: same vault/round/ranking, real judge sigs.
  useEffect(() => {
    let stale = false;
    (async () => {
      const lines = pasted
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const errors: string[] = [];
      let ranked: `0x${string}`[] | null = null;
      const seen = new Map<string, { signer: string; sig: `0x${string}` }>();
      for (const [i, line] of lines.entries()) {
        let p: SigPackage;
        try {
          p = JSON.parse(line);
        } catch {
          errors.push(`Line ${i + 1}: not valid JSON.`);
          continue;
        }
        if (p.verdikt !== 1 || !p.vault || !p.ranked || !p.sig) {
          errors.push(`Line ${i + 1}: not a Verdikt signature package.`);
          continue;
        }
        if (p.vault.toLowerCase() !== vault.address.toLowerCase()) {
          errors.push(`Line ${i + 1}: package is for a different vault.`);
          continue;
        }
        if (p.round !== String(signRound)) {
          errors.push(
            `Line ${i + 1}: signed for round ${p.round}, current is ${signRound}.`,
          );
          continue;
        }
        const r = p.ranked.map((a) => getAddress(a)) as `0x${string}`[];
        if (ranked === null) ranked = r;
        else if (JSON.stringify(r) !== JSON.stringify(ranked)) {
          errors.push(`Line ${i + 1}: ranking differs from line 1 — judges must sign the same ranking.`);
          continue;
        }
        if (!tid) continue;
        try {
          const signer = await recoverTypedDataAddress({
            ...resultTypedData(vault.address, tid as `0x${string}`, r, signRound),
            signature: p.sig,
          });
          if (!arbiters.includes(signer.toLowerCase())) {
            errors.push(`Line ${i + 1}: signer ${shortAddr(signer)} is not a judge of this tournament.`);
            continue;
          }
          seen.set(signer.toLowerCase(), { signer, sig: p.sig });
        } catch {
          errors.push(`Line ${i + 1}: signature does not verify.`);
        }
      }
      if (!stale)
        setCollect({ ranked, sigs: [...seen.values()], errors });
    })();
    return () => {
      stale = true;
    };
  }, [pasted, vault.address, tid, signRound, arbiters]);

  if (!mounted || !active || !cfg || !roster) return null;
  const [ids, wallets] = roster;
  if (wallets.length === 0) return null;

  const nameOf = (w: string) => {
    const i = wallets.findIndex(
      (x) => x.toLowerCase() === w.toLowerCase(),
    );
    return i >= 0
      ? hexToString(ids[i], { size: 32 }).replace(/\0+$/, "")
      : shortAddr(w as `0x${string}`);
  };

  async function sign() {
    setSignError(null);
    if (rankSel.some((r) => !r))
      return setSignError("Assign a player to every rank.");
    if (new Set(rankSel).size !== rankSel.length)
      return setSignError("Each player can hold only one rank.");
    const ranked = rankSel as `0x${string}`[];
    try {
      const typed = resultTypedData(
        vault.address,
        tid as `0x${string}`,
        ranked,
        signRound,
      );
      // Cross-check our local digest against the contract before asking for a signature.
      const onchain = await publicClient!.readContract({
        ...vault,
        functionName: "resultDigest",
        args: [ranked, signRound],
      });
      if (hashTypedData(typed) !== onchain)
        return setSignError(
          "Digest mismatch between app and contract — refusing to sign.",
        );
      const sig = await signTypedDataAsync(typed);
      const pkg: SigPackage = {
        verdikt: 1,
        vault: vault.address,
        round: String(signRound),
        ranked,
        signer: address!,
        sig,
      };
      const line = JSON.stringify(pkg);
      setMyPackage(line);
      setPasted((prev) => (prev.trim() ? prev.trimEnd() + "\n" + line : line));
    } catch (e) {
      setSignError(
        (e as { shortMessage?: string }).shortMessage ??
          (e as Error).message,
      );
    }
  }

  const enough = collect.sigs.length >= threshold && !!collect.ranked;

  function submit() {
    if (!collect.ranked) return;
    const sorted = [...collect.sigs]
      .sort((a, b) => (a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1))
      .map((s) => s.sig);
    writeContract({
      ...vault,
      functionName: stateName === "Challenged" ? "reResolve" : "proposeResult",
      chainId: arcTestnet.id,
      args: [collect.ranked, sorted],
    });
  }

  const field =
    "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-violet";

  return (
    <section className="mt-5 rounded-2xl border border-cyan/40 bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-[0.2em] text-cyan">
          JUDGES&apos; BENCH{stateName === "Challenged" ? " — re-resolution" : ""}
        </h2>
        <span className="text-xs text-mut">
          round {String(signRound)} · {threshold}-of-{arbiters.length} signatures
        </span>
      </div>

      {isJudge ? (
        <div className="mt-3">
          <p className="text-sm text-mut">
            You are a judge of this tournament. Rank the players and sign —
            it&apos;s an off-chain signature: no gas, no transaction, nothing to
            pay.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {rankSel.map((sel, i) => (
              <div key={i}>
                <label className="text-xs text-mut">
                  {i + 1}
                  {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"} place
                </label>
                <select
                  className={field}
                  value={sel}
                  onChange={(e) =>
                    setRankSel((prev) =>
                      prev.map((p, j) => (j === i ? e.target.value : p)),
                    )
                  }
                >
                  <option value="">— pick a player —</option>
                  {wallets.map((w) => (
                    <option key={w} value={w}>
                      {nameOf(w)} ({shortAddr(w)})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={sign}
            disabled={signing}
            className="mt-3 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-40"
          >
            {signing ? "Check your wallet…" : "Sign this ranking"}
          </button>
          {signError && (
            <p className="mt-2 text-xs text-danger">{signError}</p>
          )}
          {myPackage && (
            <div className="mt-3">
              <p className="text-xs text-cyan">
                ✓ Signed. Send this package to your co-judges (chat, email —
                anything):
              </p>
              <div className="mt-1 flex gap-2">
                <textarea
                  readOnly
                  value={myPackage}
                  rows={2}
                  className="w-full rounded-lg border border-edge bg-ink px-3 py-2 font-display text-xs text-mut"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(myPackage);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="rounded-lg border border-edge px-3 text-xs text-white hover:border-cyan"
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-mut">
          The judges sign the final ranking off-chain. Collect their signature
          packages below — anyone can relay the result on-chain.
        </p>
      )}

      <div className="mt-4 border-t border-edge pt-4">
        <label className="text-xs text-mut">
          Signature packages — one per line
        </label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={3}
          placeholder='{"verdikt":1,"vault":"0x…","round":"0","ranked":[…],"signer":"0x…","sig":"0x…"}'
          className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 font-display text-xs outline-none focus:border-violet"
        />
        <div className="mt-2 flex items-center justify-between">
          <p
            className={
              "text-xs " + (enough ? "text-cyan" : "text-mut")
            }
          >
            {collect.sigs.length}/{threshold} required signatures collected
            {enough ? " ✓" : ""}
          </p>
          <button
            onClick={submit}
            disabled={!enough || submitting || confirming}
            className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {submitting || confirming
              ? "Relaying…"
              : stateName === "Challenged"
                ? "Re-resolve on-chain"
                : "Propose result on-chain"}
          </button>
        </div>
        {collect.errors.map((e, i) => (
          <p key={i} className="mt-1 text-xs text-danger">
            {e}
          </p>
        ))}
        {submitting && <TxProgress label="Confirm in your wallet…" />}
        {confirming && (
          <TxProgress label="Relaying the attested result on-chain…" />
        )}
        {submitted && (
          <div className="mt-3 rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
            ✓ Result proposed — the challenge window is now running.
          </div>
        )}
        {submitError && (
          <p className="mt-2 text-xs text-danger">
            {(submitError as { shortMessage?: string }).shortMessage ??
              submitError.message}
          </p>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Participants panel — the roster, locked before play, public always
// ─────────────────────────────────────────────────────────────
function ParticipantsPanel({ vault }: { vault: VaultRef }) {
  const mounted = useMounted();
  const { data } = useReadContract({
    ...vault,
    functionName: "participants",
    query: { refetchInterval: 15000 },
  });

  if (!mounted || !data) return null;
  const [ids, wallets] = data;
  if (ids.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
        PARTICIPANTS ({ids.length})
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <a
            key={id}
            href={`${arcTestnet.blockExplorers.default.url}/address/${wallets[i]}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-edge px-3 py-1.5 text-sm hover:border-cyan"
          >
            <span className="font-semibold text-white">
              {hexToString(id, { size: 32 }).replace(/\0+$/, "")}
            </span>{" "}
            <span className="font-display text-xs text-mut">
              {shortAddr(wallets[i])}
            </span>
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-mut">
        Payout wallets locked at registration — prizes can only ever reach
        these addresses.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Rules panel — the judges and the rules, committed and inspectable
// ─────────────────────────────────────────────────────────────
function fmtDuration(sec: bigint): string {
  const s = Number(sec);
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600}h`;
  if (s % 60 === 0 && s >= 60) return `${s / 60}min`;
  return `${s}s`;
}

function fmtDeadline(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RulesPanel({ vault }: { vault: VaultRef }) {
  const mounted = useMounted();
  const { data: cfg } = useReadContract({
    ...vault,
    functionName: "config",
    query: { staleTime: Infinity }, // committed at deployment — read once
  });

  if (!mounted || !cfg) return null;
  const [
    admin,
    arbiters,
    threshold,
    rankBps,
    ,
    fundingDeadline,
    resolutionDeadline,
    challengeWindow,
    challengeBond,
  ] = cfg;

  return (
    <section className="mt-5 rounded-2xl border border-edge bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-[0.2em] text-mut">
          COMPETITION RULES
        </h2>
        <span className="text-xs text-mut">
          committed at deployment · immutable · verify before you deposit
        </span>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-3">
        <div>
          <p className="text-xs text-mut">
            JUDGES —{" "}
            <span className="font-semibold text-cyan">
              {String(threshold)}-of-{arbiters.length} signatures required
            </span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {arbiters.map((a) => (
              <li key={a}>
                <a
                  className="font-display text-sm text-white hover:text-cyan"
                  href={`${arcTestnet.blockExplorers.default.url}/address/${a}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(a)}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-mut">
            No one outside this list can sign a result. The list can never
            change.
          </p>
        </div>

        <div>
          <p className="text-xs text-mut">PRIZE SPLIT</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rankBps.map((bps, i) => (
              <span
                key={i}
                className="rounded-lg border border-edge px-3 py-1.5 font-display text-sm text-white"
              >
                {i + 1}
                {i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"} ·{" "}
                <span className="text-cyan">{Number(bps) / 100}%</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-mut">
            Sums to exactly 100% — rounding dust goes to 1st place.
          </p>
        </div>

        <div>
          <p className="text-xs text-mut">DISPUTES & DEADLINES</p>
          <p className="mt-2 text-sm text-white">
            Challenge window:{" "}
            <span className="font-display text-cyan">
              {fmtDuration(challengeWindow)}
            </span>
            {" · "}bond:{" "}
            <span className="font-display text-cyan">
              {fmtUsdc(challengeBond)} USDC
            </span>
          </p>
          <p className="mt-1.5 text-xs text-mut">
            Funding by {fmtDeadline(fundingDeadline)} · result by{" "}
            {fmtDeadline(resolutionDeadline)} — past a deadline, anyone can
            cancel and refunds open.
          </p>
          <p className="mt-1.5 text-xs text-mut">
            Organizer: <span className="font-display">{shortAddr(admin)}</span>{" "}
            — can never redirect a payout.
          </p>
        </div>
      </div>
    </section>
  );
}
