"use client";

import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, Hex, PublicClient, WalletClient } from "viem";

/**
 * Simulates, then sends with gas = estimate + 15%. Monad charges the gas limit, not gas used (PRD rule 6), so every
 * transaction the app sends carries a tight, explicit limit.
 */
export async function sendTight<const abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable">>(
  pub: PublicClient,
  wallet: WalletClient,
  req: { address: Address; abi: abi; functionName: fn; args: ContractFunctionArgs<abi, "nonpayable", fn> },
): Promise<{ hash: Hex; blockNumber: bigint }> {
  const account = wallet.account!;
  const call = { ...req, account } as never;
  await pub.simulateContract(call);
  const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  const hash = await wallet.writeContract({ ...(req as object), account, chain: wallet.chain, gas } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return { hash, blockNumber: receipt.blockNumber };
}

export function errorText(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message?.split("\n")[0] ?? "Something went wrong.";
}
