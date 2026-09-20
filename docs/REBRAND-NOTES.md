# Verdikt — notes de rebranding (ex-ArcGG)

34/34 tests verts · build Next vert · ABI régénérés.

## ⚠️ Le point critique : le domain separator EIP-712

`"ArcGG PrizePoolVault"` → `"Verdikt PrizePoolVault"` dans ArbiterAttestation.sol.
Les TROIS signeurs ont été resynchronisés ensemble (sinon les signatures ne
vérifient plus) :
- contracts/src/ArbiterAttestation.sol (le contrat)
- demo/sign-result.mjs (le script)
- app/app/page.tsx (le Judges' Bench in-app)

Conséquence : **les vaults déjà déployés (ancien separator) ne sont plus
compatibles avec le nouveau front**. Sans importance — on redéploie tout pour
le mainnet, et les anciens tournois testnet sont finis ou annulables.

## Arborescence des fichiers

| Fichier livré | Destination |
|---|---|
| VerdiktFactory.sol | contracts/src/ (supprimer ArcGGFactory.sol) |
| ArbiterAttestation.sol, PrizePoolVault.sol | contracts/src/ |
| VerdiktFactory.t.sol | contracts/test/ (supprimer ArcGGFactory.t.sol) |
| AuditPoC.t.sol, PrizePoolVault.t.sol | contracts/test/ |
| DeployFactory.s.sol, Deploy.s.sol | contracts/script/ |
| factory.ts, abi.ts | app/lib/ |
| page.tsx, layout.tsx | app/app/ |
| README.md | racine |
| audit-2026-09.md | docs/ (créer le dossier) |
| sign-result.mjs | demo/ |

Côté git, préférer `git mv` pour les deux renommages afin de garder l'historique :
```
git mv contracts/src/ArcGGFactory.sol contracts/src/VerdiktFactory.sol
git mv contracts/test/ArcGGFactory.t.sol contracts/test/VerdiktFactory.t.sol
```
(puis écraser avec les fichiers livrés)

## Ce qui a changé côté produit

- Marque : ArcGG → **Verdikt**, logo texte `Verd|ikt`, tagline
  « THE JURY SIGNS. THE MONEY MOVES. »
- Scope : "esports tournaments" → "any competition" (hackathons, tournois,
  concours de design, bounties). Le mot "tournament" devient "competition"
  dans toute la copy UI ; les noms de fonctions/params du contrat sont
  inchangés (createTournament reste — renommer aurait cassé l'ABI sans gain).
- Le paquet de signature JSON porte maintenant la clé `verdikt: 1`
  (au lieu de `arcgg: 1`) — les anciens paquets seront rejetés, sans impact.
- README : nouveau positionnement "attested payout escrow", mention honnête de
  l'origine hackathon, 34 tests, audit interne référencé.
- Le rapport d'audit entre dans le repo : docs/audit-2026-09.md

## Reste à faire

1. Renommer le repo GitHub → `verdikt` (sous l'org verdiktxyz ou ton compte).
   GitHub garde les redirections : les liens du hackathon continueront de marcher.
2. Vercel : renommer le projet + brancher verdiktprotocol.xyz.
3. FACTORY_ADDRESS dans app/lib/factory.ts = encore l'ancienne factory testnet.
   À remplacer après le déploiement (testnet de vérif, puis mainnet).
4. Ajouter le bandeau beta (plafonds de pool) avant d'ouvrir au public.
