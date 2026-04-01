# Remaining Gaps

Data gaps between the Influx indexer and the Whisk/Morpho GraphQL API that are not yet handled.

---

## 1. Token Icon & Category

**Affects**: `TokenInfoFragment` fields `icon` and `category`.

**What's needed**: A static mapping of Injective token addresses to their icon URLs and categories. Fields exist in the schema with empty string defaults — just need the data.

---

## 2. Curator Metadata

**Affects**: `CuratorInfoFragment` fields `name`, `image`, `url`.

**What's needed**: A static mapping of curator addresses to their metadata (name, image URL, website URL). `Vault.curator` already stores the on-chain address — the mapping can be applied in the query/API layer.

---

## 3. Vault Description

**Affects**: `Vault` detail query field `metadata.description`.

**What's needed**: Description text for each vault. `Vault.description` field exists in the schema with empty string default — just need the content.

---

## 4. Wallet Token Balances

**Affects**: `VaultPositions` field `walletUnderlyingAssetHolding.balance`, `MarketPositions` fields `walletLoanAssetHolding.balance` and `walletCollateralAssetHolding.balance`.

**Why this can't be indexed**: Wallet balances change from any ERC20 transfer (DEX swaps, sends, etc.), not just Morpho contract events. The indexer only sees Morpho events, so it cannot track arbitrary token transfers for every user.

**What's needed**: The frontend should call ERC20 `balanceOf(address)` directly via RPC when rendering position views. No indexer change required.

---

## 5. Reward APRs

**Affects**: `ApyFragment` field `rewards[] { asset, apr }`.

**Current state**: No active reward programs identified on Injective Morpho. The query layer should return `rewards: []` and `total = base`.

**What's needed**: When reward programs are added (e.g. MORPHO emissions, INJ incentives), we need the reward distributor contract address + ABI to index emission rates.

---

## 6. Chain Metadata

**Affects**: `ChainInfoFragment` fields `name` and `icon`.

**What's needed**: Hardcode in the frontend/query layer: `{ id: 1776, name: "Injective", icon: "<url>" }`. Provide an icon URL if there's a preferred one. No indexer change needed.

---

## 7. OFAC Sanctions Check

**Affects**: `getAccountIsOfacSanctioned` query.

**What's needed**: A compliance screening provider (Chainalysis, TRM Labs, or a custom sanctions list). This is entirely external to the indexer — implement as a standalone API route.
