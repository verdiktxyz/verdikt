#!/usr/bin/env node
/**
 * ArcGG — arbiter result signing (EIP-712, M-of-N)
 *
 * Signs the Result(tournamentId, rankingHash, round) struct with each arbiter
 * key, cross-checks the digest against the vault's own resultDigest() view,
 * sorts signatures by ascending signer address (the contract requires it),
 * and prints the calldata arrays ready for `cast send proposeResult/reResolve`.
 *
 * Usage:
 *   RPC=https://rpc.testnet.arc.network \
 *   VAULT=0x... \
 *   RANKED=0xwinner,0xsecond,0xthird \
 *   ROUND=0 \
 *   ARBITER_PKS=0xpk1,0xpk2 \
 *   node sign-result.mjs
 */
import {
  createPublicClient,
  http,
  hashTypedData,
  keccak256,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC ?? "https://rpc.testnet.arc.network";
const VAULT = process.env.VAULT;
const RANKED = (process.env.RANKED ?? "").split(",").filter(Boolean);
const ROUND = BigInt(process.env.ROUND ?? "0");
const PKS = (process.env.ARBITER_PKS ?? "").split(",").filter(Boolean);

if (!VAULT || RANKED.length === 0 || PKS.length === 0) {
  console.error("Missing env: VAULT, RANKED, ARBITER_PKS (and optionally ROUND, RPC)");
  process.exit(1);
}

const client = createPublicClient({ transport: http(RPC) });

const abi = [
  { type: "function", name: "tournamentId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "resultDigest", stateMutability: "view",
    inputs: [{ name: "rankedWallets", type: "address[]" }, { name: "round", type: "uint256" }],
    outputs: [{ type: "bytes32" }] },
];

const chainId = await client.getChainId();
const tournamentId = await client.readContract({ address: VAULT, abi, functionName: "tournamentId" });

// Local EIP-712 digest — must mirror ArbiterAttestation exactly.
const rankingHash = keccak256(encodeAbiParameters([{ type: "address[]" }], [RANKED]));
const digest = hashTypedData({
  domain: {
    name: "ArcGG PrizePoolVault",
    version: "1",
    chainId,
    verifyingContract: VAULT,
  },
  types: {
    Result: [
      { name: "tournamentId", type: "bytes32" },
      { name: "rankingHash", type: "bytes32" },
      { name: "round", type: "uint256" },
    ],
  },
  primaryType: "Result",
  message: { tournamentId, rankingHash, round: ROUND },
});

// Cross-check against the contract's own view — fail hard on any mismatch.
const onchain = await client.readContract({
  address: VAULT, abi, functionName: "resultDigest", args: [RANKED, ROUND],
});
if (onchain.toLowerCase() !== digest.toLowerCase()) {
  console.error("DIGEST MISMATCH — local:", digest, "on-chain:", onchain);
  process.exit(1);
}

// Sign the raw digest with each arbiter key, then sort by signer address.
const signed = [];
for (const pk of PKS) {
  const account = privateKeyToAccount(pk.trim().startsWith('0x') ? pk.trim() : `0x${pk.trim()}`);
  const signature = await account.sign({ hash: digest });
  signed.push({ signer: account.address, signature });
}
signed.sort((a, b) =>
  a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1
);

console.log("digest       :", digest);
console.log("round        :", ROUND.toString());
for (const s of signed) console.log("signer       :", s.signer);
console.log();
console.log("RANKED_ARG   :", `[${RANKED.join(",")}]`);
console.log("SIGS_ARG     :", `[${signed.map((s) => s.signature).join(",")}]`);


// Also write shell-sourceable exports so the propose step needs no copy-paste.
import { writeFileSync } from "node:fs";
writeFileSync(
  "result-args.env",
  `export RANKED_ARG='[${RANKED.join(",")}]'\n` +
  `export SIGS_ARG='[${signed.map((s) => s.signature).join(",")}]'\n`
);
console.log();
console.log("Wrote result-args.env — in contracts/, run:");
console.log("  source ../demo/result-args.env && cast send $VAULT \"proposeResult(address[],bytes[])\" \"$RANKED_ARG\" \"$SIGS_ARG\" --private-key $PRIVATE_KEY --rpc-url $RPC");