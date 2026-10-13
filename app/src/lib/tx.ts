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
  const [balance, fees] = await Promise.all([pub.getBalance({ address: account.address }), pub.estimateFeesPerGas()]);
  let gas: bigint;
  try {
    await pub.simulateContract(call);
    gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  } catch (e) {
    // A wallet that can't cover a heavy call's gas shows up as a bare "reverted" on Monad. Say what is wrong instead.
    if (balance < LOW_GAS) throw new Error(notEnoughGas(balance));
    throw e;
  }
  // Monad charges the whole gas limit, so the wallet must hold limit x fee up front.
  if (balance < gas * fees.maxFeePerGas) throw new Error(notEnoughGas(balance, gas * fees.maxFeePerGas));
  const hash = await wallet.writeContract({ ...(req as object), account, chain: wallet.chain, gas } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return { hash, blockNumber: receipt.blockNumber };
}

/** Below this, a failing call is far more likely to be gas than logic: creating an account alone needs about 0.4 MON. */
const LOW_GAS = 500_000_000_000_000_000n;

const mon = (wei: bigint) => (Number(wei) / 1e18).toFixed(3);

function notEnoughGas(balance: bigint, needed?: bigint) {
  return `Not enough test MON for gas: you have ${mon(balance)} MON${needed ? `, this step needs ${mon(needed)}` : ""}. Tap "Get test funds", or get MON from the Monad faucet.`;
}

export function errorText(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message?.split("\n")[0] ?? "Something went wrong.";
}
