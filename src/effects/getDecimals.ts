import { createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from "viem";

const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)"]);

// Injective-only indexer: keep a single RPC mapping.
const RPC_URLS: Record<number, string> = {
  1776: process.env.RPC_URL_1776 ?? "https://injective.drpc.org",
};

export const getDecimals = createEffect(
  {
    name: "getDecimals",
    input: S.schema({
      address: S.string,
      chainId: S.number,
    }),
    output: S.number,
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const rpcUrl =
        RPC_URLS[input.chainId] ?? Object.values(RPC_URLS)[0];
      const client = createPublicClient({
        transport: http(rpcUrl),
      });

      const decimals = await client.readContract({
        address: input.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      });

      return Number(decimals);
    } catch {
      return 18;
    }
  },
);
