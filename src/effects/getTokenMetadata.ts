import { createEffect, S } from "envio";
import { createPublicClient, http, parseAbi } from "viem";

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const RPC_URLS: Record<number, string> = {
  1776: process.env.RPC_URL_1776 ?? "https://sentry.evm-rpc.injective.network",
};

export const getTokenMetadata = createEffect(
  {
    name: "getTokenMetadata",
    input: S.schema({
      address: S.string,
      chainId: S.number,
    }),
    output: S.schema({
      name: S.string,
      symbol: S.string,
      decimals: S.number,
    }),
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

      const address = input.address as `0x${string}`;

      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address, abi: ERC20_ABI, functionName: "name" }),
        client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
      ]);

      return {
        name: name as string,
        symbol: symbol as string,
        decimals: Number(decimals),
      };
    } catch(e) {
      return { name: "Unknown", symbol: "???", decimals: 18 };
    }
  },
);
