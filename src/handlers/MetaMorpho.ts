import { MetaMorphoFactory, MetaMorpho, BigDecimal } from "generated";
import { getTokenMetadata } from "../effects/getTokenMetadata.js";
import {
  ZERO_ADDRESS,
  vaultId,
  vaultBalanceId,
  vaultConfigItemId,
  vaultQueueItemId,
  marketId,
  tokenId,
  GLOBAL_STATE_ID,
} from "../utils/ids.js";

const ZERO_BD = BigDecimal("0");

/*//////////////////////////////////////////////////////////////
                        CONTRACT REGISTER
//////////////////////////////////////////////////////////////*/

MetaMorphoFactory.CreateMetaMorpho.contractRegister(({ event, context }) => {
  context.addMetaMorpho(event.params.metaMorpho);
});

/*//////////////////////////////////////////////////////////////
                        CREATE VAULT
//////////////////////////////////////////////////////////////*/

MetaMorphoFactory.CreateMetaMorpho.handler(async ({ event, context }) => {
  const meta = await context.effect(getTokenMetadata, {
    address: event.params.asset,
    chainId: event.chainId,
  });
  const decimalsUnderlying = meta.decimals;
  const decimalsOffset = Math.max(0, 18 - decimalsUnderlying);

  // Upsert Token entity for vault asset
  const tId = tokenId(event.chainId, event.params.asset);
  const existingToken = await context.Token.get(tId);
  let newTokenId: string | undefined;
  if (!existingToken) {
    context.Token.set({
      id: tId,
      chainId: event.chainId,
      address: event.params.asset,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      priceUsd: ZERO_BD,
      icon: "",      // TODO: populate from static token metadata config
      category: "",  // TODO: populate from static token metadata config
    });
    newTokenId = tId;
  }

  const id = vaultId(event.chainId, event.params.metaMorpho);

  context.Vault.set({
    id,
    chainId: event.chainId,
    address: event.params.metaMorpho,
    asset: event.params.asset,
    decimalsUnderlying,
    decimalsOffset,
    totalSupply: 0n,
    owner: event.params.initialOwner,
    pendingOwner: ZERO_ADDRESS,
    curator: ZERO_ADDRESS,
    allocators: [],
    guardian: ZERO_ADDRESS,
    timelock: event.params.initialTimelock,
    pendingGuardian: ZERO_ADDRESS,
    pendingGuardianValidAt: 0n,
    pendingTimelock: 0n,
    pendingTimelockValidAt: 0n,
    fee: 0n,
    feeRecipient: ZERO_ADDRESS,
    skimRecipient: ZERO_ADDRESS,
    supplyQueueLength: 0,
    withdrawQueueLength: 0,
    lastTotalAssets: 0n,
    lostAssets: 0n,
    name: event.params.name,
    symbol: event.params.symbol,
    description: "", // TODO: populate from off-chain vault metadata config
  });

  // Update GlobalState to track this vault and new token
  const gs = await context.GlobalState.get(GLOBAL_STATE_ID);
  const existingTokenIds = gs ? (gs.tokenIds as string[]) : [];
  context.GlobalState.set({
    id: GLOBAL_STATE_ID,
    marketIds: gs ? gs.marketIds : [],
    vaultIds: [...(gs ? (gs.vaultIds as string[]) : []), id],
    tokenIds: newTokenId
      ? [...existingTokenIds, newTokenId]
      : existingTokenIds,
  });
});

/*//////////////////////////////////////////////////////////////
                            OWNERSHIP
//////////////////////////////////////////////////////////////*/

MetaMorpho.OwnershipTransferStarted.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    pendingOwner: event.params.newOwner,
  });
});

MetaMorpho.OwnershipTransferred.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    owner: event.params.newOwner,
    pendingOwner: ZERO_ADDRESS,
  });
});

/*//////////////////////////////////////////////////////////////
                              SUBMIT
//////////////////////////////////////////////////////////////*/

MetaMorpho.SubmitCap.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const v = await context.Vault.get(vId);
  const timelock = v?.timelock ?? 0n;

  const configId = vaultConfigItemId(
    event.chainId,
    event.srcAddress,
    event.params.id,
  );
  const config = await context.VaultConfigItem.getOrCreate({
    id: configId,
    chainId: event.chainId,
    vault_id: vId,
    market_id: marketId(event.chainId, event.params.id),
    cap: 0n,
    pendingCap: 0n,
    pendingCapValidAt: 0n,
    enabled: false,
    removableAt: 0n,
  });
  context.VaultConfigItem.set({
    ...config,
    pendingCap: event.params.cap,
    pendingCapValidAt: BigInt(event.block.timestamp) + timelock,
  });
});

MetaMorpho.SubmitGuardian.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  const timelock = existing.timelock;

  context.Vault.set({
    ...existing,
    pendingGuardian: event.params.newGuardian,
    pendingGuardianValidAt: BigInt(event.block.timestamp) + timelock,
  });
});

MetaMorpho.SubmitMarketRemoval.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const v = await context.Vault.get(vId);
  const timelock = v?.timelock ?? 0n;

  const configId = vaultConfigItemId(
    event.chainId,
    event.srcAddress,
    event.params.id,
  );
  const existing = await context.VaultConfigItem.get(configId);
  if (!existing) return;

  context.VaultConfigItem.set({
    ...existing,
    removableAt: BigInt(event.block.timestamp) + timelock,
  });
});

MetaMorpho.SubmitTimelock.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  const timelock = existing.timelock;

  context.Vault.set({
    ...existing,
    pendingTimelock: event.params.newTimelock,
    pendingTimelockValidAt: BigInt(event.block.timestamp) + timelock,
  });
});

/*//////////////////////////////////////////////////////////////
                              REVOKE
//////////////////////////////////////////////////////////////*/

MetaMorpho.RevokePendingCap.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const configId = vaultConfigItemId(
    event.chainId,
    event.srcAddress,
    event.params.id,
  );
  const config = await context.VaultConfigItem.getOrCreate({
    id: configId,
    chainId: event.chainId,
    vault_id: vId,
    market_id: marketId(event.chainId, event.params.id),
    cap: 0n,
    pendingCap: 0n,
    pendingCapValidAt: 0n,
    enabled: false,
    removableAt: 0n,
  });
  context.VaultConfigItem.set({
    ...config,
    pendingCap: 0n,
    pendingCapValidAt: 0n,
  });
});

MetaMorpho.RevokePendingGuardian.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    pendingGuardian: ZERO_ADDRESS,
    pendingGuardianValidAt: 0n,
  });
});

MetaMorpho.RevokePendingMarketRemoval.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const configId = vaultConfigItemId(
    event.chainId,
    event.srcAddress,
    event.params.id,
  );
  const config = await context.VaultConfigItem.getOrCreate({
    id: configId,
    chainId: event.chainId,
    vault_id: vId,
    market_id: marketId(event.chainId, event.params.id),
    cap: 0n,
    pendingCap: 0n,
    pendingCapValidAt: 0n,
    enabled: false,
    removableAt: 0n,
  });
  context.VaultConfigItem.set({
    ...config,
    removableAt: 0n,
  });
});

MetaMorpho.RevokePendingTimelock.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    pendingTimelock: 0n,
    pendingTimelockValidAt: 0n,
  });
});

/*//////////////////////////////////////////////////////////////
                              SET
//////////////////////////////////////////////////////////////*/

MetaMorpho.SetCap.handler(async ({ event, context }) => {
  const configId = vaultConfigItemId(
    event.chainId,
    event.srcAddress,
    event.params.id,
  );
  const existing = await context.VaultConfigItem.get(configId);
  if (!existing) return;

  context.VaultConfigItem.set({
    ...existing,
    cap: event.params.cap,
    pendingCap: 0n,
    pendingCapValidAt: 0n,
    ...(event.params.cap > 0n ? { enabled: true, removableAt: 0n } : {}),
  });
});

MetaMorpho.SetCurator.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    curator: event.params.newCurator,
  });
});

MetaMorpho.SetVaultFee.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    fee: event.params.newFee,
  });
});

MetaMorpho.SetFeeRecipient.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    feeRecipient: event.params.newFeeRecipient,
  });
});

MetaMorpho.SetGuardian.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    guardian: event.params.guardian,
    pendingGuardian: ZERO_ADDRESS,
    pendingGuardianValidAt: 0n,
  });
});

MetaMorpho.SetIsAllocator.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  const allocators = existing.allocators as string[];
  const set = new Set(allocators);
  if (event.params.isAllocator) {
    set.add(event.params.allocator);
  } else {
    set.delete(event.params.allocator);
  }

  context.Vault.set({
    ...existing,
    allocators: [...set],
  });
});

MetaMorpho.SetName.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    name: event.params.name,
  });
});

MetaMorpho.SetSkimRecipient.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    skimRecipient: event.params.newSkimRecipient,
  });
});

MetaMorpho.SetSymbol.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    symbol: event.params.symbol,
  });
});

MetaMorpho.SetTimelock.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    timelock: event.params.newTimelock,
    pendingTimelock: 0n,
    pendingTimelockValidAt: 0n,
  });
});

/*//////////////////////////////////////////////////////////////
                              QUEUES
//////////////////////////////////////////////////////////////*/

MetaMorpho.SetSupplyQueue.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const v = await context.Vault.get(vId);
  if (!v) return;

  const oldLength = v.supplyQueueLength;
  const newQueue = event.params.newSupplyQueue;

  context.Vault.set({
    ...v,
    supplyQueueLength: newQueue.length,
  });

  const maxLen = Math.max(oldLength, newQueue.length);
  for (let ordinal = 0; ordinal < maxLen; ordinal++) {
    const queueItemId = vaultQueueItemId(
      event.chainId,
      event.srcAddress,
      ordinal,
    );
    const queueMarketId = newQueue[ordinal] ?? undefined;

    const queueItem = await context.VaultSupplyQueueItem.getOrCreate({
      id: queueItemId,
      chainId: event.chainId,
      vault_id: vId,
      ordinal,
      market_id: undefined,
    });
    context.VaultSupplyQueueItem.set({
      ...queueItem,
      market_id: queueMarketId
        ? marketId(event.chainId, queueMarketId)
        : undefined,
    });
  }
});

MetaMorpho.SetWithdrawQueue.handler(async ({ event, context }) => {
  const vId = vaultId(event.chainId, event.srcAddress);
  const v = await context.Vault.get(vId);
  if (!v) return;

  const oldLength = v.withdrawQueueLength;
  const newQueue = event.params.newWithdrawQueue;

  context.Vault.set({
    ...v,
    withdrawQueueLength: newQueue.length,
  });

  const maxLen = Math.max(oldLength, newQueue.length);
  for (let ordinal = 0; ordinal < maxLen; ordinal++) {
    const queueItemId = vaultQueueItemId(
      event.chainId,
      event.srcAddress,
      ordinal,
    );
    const queueMarketId = newQueue[ordinal] ?? undefined;

    const queueItem = await context.VaultWithdrawQueueItem.getOrCreate({
      id: queueItemId,
      chainId: event.chainId,
      vault_id: vId,
      ordinal,
      market_id: undefined,
    });
    context.VaultWithdrawQueueItem.set({
      ...queueItem,
      market_id: queueMarketId
        ? marketId(event.chainId, queueMarketId)
        : undefined,
    });
  }
});

/*//////////////////////////////////////////////////////////////
                          SHARES/ASSETS
//////////////////////////////////////////////////////////////*/

MetaMorpho.Transfer.handler(async ({ event, context }) => {
  if (event.params.value === 0n) return;

  const vId = vaultId(event.chainId, event.srcAddress);

  if (event.params.from === ZERO_ADDRESS) {
    // Mint — increase totalSupply
    const v = await context.Vault.get(vId);
    if (v) {
      context.Vault.set({
        ...v,
        totalSupply: v.totalSupply + event.params.value,
      });
    }
  } else {
    // Not a mint — subtract from sender's balance
    const fromBalanceId = vaultBalanceId(
      event.chainId,
      event.srcAddress,
      event.params.from,
    );
    const fromBalance = await context.VaultBalance.getOrThrow(fromBalanceId);
    context.VaultBalance.set({
      ...fromBalance,
      shares: fromBalance.shares - event.params.value,
    });
  }

  if (event.params.to === ZERO_ADDRESS) {
    // Burn — decrease totalSupply
    const v = await context.Vault.get(vId);
    if (v) {
      context.Vault.set({
        ...v,
        totalSupply: v.totalSupply - event.params.value,
      });
    }
  } else {
    // Not a burn — add to receiver's balance (upsert)
    const toBalanceId = vaultBalanceId(
      event.chainId,
      event.srcAddress,
      event.params.to,
    );
    const toBalance = await context.VaultBalance.getOrCreate({
      id: toBalanceId,
      chainId: event.chainId,
      vault_id: vId,
      user: event.params.to,
      shares: 0n,
    });
    context.VaultBalance.set({
      ...toBalance,
      shares: toBalance.shares + event.params.value,
    });
  }
});

MetaMorpho.UpdateLastTotalAssets.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    lastTotalAssets: event.params.updatedTotalAssets,
  });
});

MetaMorpho.UpdateLostAssets.handler(async ({ event, context }) => {
  const id = vaultId(event.chainId, event.srcAddress);
  const existing = await context.Vault.get(id);
  if (!existing) return;

  context.Vault.set({
    ...existing,
    lostAssets: event.params.newLostAssets,
  });
});
