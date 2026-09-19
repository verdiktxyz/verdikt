// Generated from contracts/out/VerdiktFactory.sol/VerdiktFactory.json — do not edit by hand.
// TODO: replace with the mainnet factory address after DeployFactory.s.sol
export const FACTORY_ADDRESS = "0xd01F9Fda58f6AecD303664E4f320152f077810c2" as const;

export const factoryAbi = [
  {
    "type": "function",
    "name": "all",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct VerdiktFactory.TournamentInfo[]",
        "components": [
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "organizer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "count",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createTournament",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct VerdiktFactory.CreateParams",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "arbiters",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "threshold",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "prizePool",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rankBps",
            "type": "uint16[]",
            "internalType": "uint16[]"
          },
          {
            "name": "fundingDuration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "resolutionDuration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "challengeWindow",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "challengeBond",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "vault",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "page",
    "inputs": [
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "out",
        "type": "tuple[]",
        "internalType": "struct VerdiktFactory.TournamentInfo[]",
        "components": [
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "organizer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "TournamentCreated",
    "inputs": [
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "organizer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  }
] as const;
