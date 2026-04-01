import { onBlock, BigDecimal } from "generated";
import {
  GLOBAL_STATE_ID,
  marketSnapshotId,
  vaultSnapshotId,
} from "../utils/ids.js";
import { getTokenPriceUsd } from "../effects/getTokenPriceUsd.js";

const ZERO_BD = BigDecimal("0");

// Hourly snapshots on Injective (~1s block time → interval 3600)
onBlock(
  { name: "HourlySnapshots", chain: 1776, interval: 3600 },
  async ({ block, context }) => {
    const globalState = await context.GlobalState.get(GLOBAL_STATE_ID);
    if (!globalState) return;

    const blockNumber = block.number;
    const marketIds = globalState.marketIds as string[];
    const vaultIds = globalState.vaultIds as string[];
    const tokenIds = globalState.tokenIds as string[];

    // --- Update token USD prices ---
    for (const tId of tokenIds) {
      const token = await context.Token.get(tId);
      if (!token) continue;

      const priceResult = await context.effect(getTokenPriceUsd, {
        address: token.address,
        chainId: token.chainId,
      });

      if (priceResult.priceUsd > 0) {
        context.Token.set({
          ...token,
          priceUsd: BigDecimal(priceResult.priceUsd.toString()),
        });
      }
    }

    // --- Build a map of market ID → Market for vault APY computation ---
    const marketMap = new Map<
      string,
      { currentSupplyApy: BigDecimal; totalSupplyAssets: bigint; totalSupplyShares: bigint; lastUpdate: bigint }
    >();

    // --- Snapshot all markets ---
    for (const mId of marketIds) {
      const market = await context.Market.get(mId);
      if (!market) continue;

      marketMap.set(mId, {
        currentSupplyApy: market.currentSupplyApy,
        totalSupplyAssets: market.totalSupplyAssets,
        totalSupplyShares: market.totalSupplyShares,
        lastUpdate: market.lastUpdate,
      });

      context.MarketSnapshot.set({
        id: marketSnapshotId(mId, blockNumber),
        chainId: market.chainId,
        market_id: mId,
        blockNumber,
        lastUpdate: market.lastUpdate,
        totalSupplyAssets: market.totalSupplyAssets,
        totalBorrowAssets: market.totalBorrowAssets,
        totalCollateral: market.totalCollateral,
        borrowApy: market.currentBorrowApy,
        supplyApy: market.currentSupplyApy,
        utilization: market.currentUtilization,
        rateAtTarget: market.rateAtTarget,
      });
    }

    // --- Snapshot all vaults (with supply APY computation) ---
    for (const vId of vaultIds) {
      const vault = await context.Vault.get(vId);
      if (!vault) continue;

      // Compute vault supply APY as weighted average of market supply APYs
      // weighted by the vault's supply in each market relative to total vault assets
      let vaultSupplyApy = ZERO_BD;
      let bestTimestamp = 0n;

      if (vault.lastTotalAssets > 0n) {
        let weightedApySum = 0;
        const totalAssets = Number(vault.lastTotalAssets);

        // Iterate this vault's supply queue to find allocated markets
        for (let ordinal = 0; ordinal < vault.supplyQueueLength; ordinal++) {
          const queueItemId = `${vId}-${ordinal}`;
          const queueItem = await context.VaultSupplyQueueItem.get(queueItemId);
          if (!queueItem || !queueItem.market_id) continue;

          const mId = queueItem.market_id;
          const marketData = marketMap.get(mId);
          if (!marketData) continue;

          // Track best timestamp
          if (marketData.lastUpdate > bestTimestamp) {
            bestTimestamp = marketData.lastUpdate;
          }

          // Get the vault's position in this market
          // vault address is the "user" in the Position entity
          const pId = `${vault.chainId}-${mId.split("-").slice(1).join("-")}-${vault.address}`;
          const position = await context.Position.get(pId);
          if (!position || position.supplyShares === 0n) continue;

          // Convert vault's supply shares to assets
          if (marketData.totalSupplyShares === 0n) continue;
          const vaultSupplyAssets =
            Number(position.supplyShares) *
            Number(marketData.totalSupplyAssets) /
            Number(marketData.totalSupplyShares);

          const weight = vaultSupplyAssets / totalAssets;
          const marketApy = Number(marketData.currentSupplyApy.toString());
          weightedApySum += marketApy * weight;
        }

        // Apply vault fee
        const feeMultiplier = 1 - Number(vault.fee) / 1e18;
        vaultSupplyApy = BigDecimal((weightedApySum * feeMultiplier).toString());
      }

      context.VaultSnapshot.set({
        id: vaultSnapshotId(vId, blockNumber),
        chainId: vault.chainId,
        vault_id: vId,
        blockNumber,
        lastUpdate: bestTimestamp > 0n ? bestTimestamp : 0n,
        totalAssets: vault.lastTotalAssets,
        totalSupply: vault.totalSupply,
        supplyApy: vaultSupplyApy,
      });
    }
  },
);
