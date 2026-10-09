// Envio HyperIndex handlers (PRD 10.3). Monad full nodes serve no historical state, so everything historical the UI
// shows, track records, equity curves, blocked attempts, breach timelines, comes from here.
import { indexer } from "envio";

const eventId = (event: { transaction: { hash: string }; logIndex: number }) => `${event.transaction.hash}-${event.logIndex}`;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Every MandateAccount is created by the factory, so that is where the indexer learns about new accounts. */
indexer.contractRegister({ contract: "MandateAccountFactory", event: "AccountCreated" }, async ({ event, context }) => {
  context.chain.MandateAccount.add(event.params.account);
});

indexer.onEvent({ contract: "MandateAccountFactory", event: "AccountCreated" }, async ({ event, context }) => {
  context.Account.set({
    id: event.params.account.toLowerCase(),
    owner: event.params.owner,
    operator: event.params.operator,
    createdAtBlock: BigInt(event.block.number),
    mandate_id: undefined,
    sessionKey: undefined,
    sessionKeyExpiresAtBlock: undefined,
    closeOnly: false,
    executions: 0,
    violationsAttempted: 0,
    breaches: 0,
    lastEquity: undefined,
    lastNotional: undefined,
    peakEquity: undefined,
    withdrawnTotal: 0n,
  });
});

// ---------------------------------------------------------------- registry

indexer.onEvent({ contract: "MandateRegistry", event: "MandateCreated" }, async ({ event, context }) => {
  const accountId = event.params.account.toLowerCase();
  const account = await context.Account.get(accountId);
  context.Mandate.set({
    id: event.params.mandateId.toString(),
    account_id: accountId,
    backer: event.params.backer,
    operator: account?.operator ?? ZERO_ADDRESS,
    reportHash: event.params.reportHash,
    createdAtBlock: BigInt(event.block.number),
    active: true,
    deactivatedAtBlock: undefined,
  });
  if (account) context.Account.set({ ...account, mandate_id: event.params.mandateId.toString() });
});

indexer.onEvent({ contract: "MandateRegistry", event: "RuleSet" }, async ({ event, context }) => {
  const id = `${event.params.mandateId}-${event.params.ruleIndex}`;
  const existing = await context.Rule.get(id);
  const rule = event.params.rule;
  context.Rule.set({
    id,
    mandate_id: event.params.mandateId.toString(),
    ruleIndex: Number(event.params.ruleIndex),
    kind: Number(rule[0]),
    p1: rule[1],
    p2: rule[2],
    p3: rule[3],
    tightenedCount: existing ? existing.tightenedCount + 1 : 0,
    lastUpdatedBlock: BigInt(event.block.number),
  });
});

indexer.onEvent({ contract: "MandateRegistry", event: "MandateDeactivated" }, async ({ event, context }) => {
  const mandate = await context.Mandate.get(event.params.mandateId.toString());
  if (mandate) {
    context.Mandate.set({ ...mandate, active: false, deactivatedAtBlock: BigInt(event.block.number) });
  }
  const account = await context.Account.get(event.params.account.toLowerCase());
  if (account) context.Account.set({ ...account, closeOnly: true });
});

// ---------------------------------------------------------------- accounts

indexer.onEvent({ contract: "MandateAccount", event: "Executed" }, async ({ event, context }) => {
  const accountId = event.params.account.toLowerCase();
  context.Execution.set({
    id: eventId(event),
    account_id: accountId,
    blockNumber: event.params.blockNumber,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    equity: event.params.equity,
    notional: event.params.notional,
  });
  context.EquityPoint.set({
    id: eventId(event),
    account_id: accountId,
    blockNumber: event.params.blockNumber,
    timestamp: BigInt(event.block.timestamp),
    equity: event.params.equity,
    notional: event.params.notional,
    peakEquity: undefined,
    source: "execute",
  });
  const account = await context.Account.get(accountId);
  if (account) {
    const peak = account.peakEquity ?? 0n;
    context.Account.set({
      ...account,
      executions: account.executions + 1,
      lastEquity: event.params.equity,
      lastNotional: event.params.notional,
      peakEquity: event.params.equity > peak ? event.params.equity : peak,
    });
  }
});

indexer.onEvent({ contract: "MandateAccount", event: "ViolationAttempted" }, async ({ event, context }) => {
  const accountId = event.params.account.toLowerCase();
  context.Violation.set({
    id: eventId(event),
    account_id: accountId,
    blockNumber: event.params.blockNumber,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    ruleIndex: Number(event.params.ruleIndex),
    observed: event.params.observed,
    limit: event.params.limit,
    callsHash: event.params.callsHash,
  });
  const account = await context.Account.get(accountId);
  if (account) context.Account.set({ ...account, violationsAttempted: account.violationsAttempted + 1 });
});

indexer.onEvent({ contract: "MandateAccount", event: "Unwound" }, async ({ event, context }) => {
  const account = await context.Account.get(event.params.account.toLowerCase());
  if (account) context.Account.set({ ...account, closeOnly: true, lastNotional: event.params.notionalLeft });
});

indexer.onEvent({ contract: "MandateAccount", event: "SessionKeySet" }, async ({ event, context }) => {
  const account = await context.Account.get(event.srcAddress.toLowerCase());
  if (account) {
    context.Account.set({ ...account, sessionKey: event.params.key, sessionKeyExpiresAtBlock: BigInt(event.params.expiresAtBlock) });
  }
});

indexer.onEvent({ contract: "MandateAccount", event: "SessionKeyRevoked" }, async ({ event, context }) => {
  const account = await context.Account.get(event.srcAddress.toLowerCase());
  if (account) context.Account.set({ ...account, sessionKey: undefined, sessionKeyExpiresAtBlock: undefined });
});

indexer.onEvent({ contract: "MandateAccount", event: "Withdrawn" }, async ({ event, context }) => {
  const account = await context.Account.get(event.srcAddress.toLowerCase());
  if (account) context.Account.set({ ...account, withdrawnTotal: account.withdrawnTotal + event.params.amount });
});

// ---------------------------------------------------------------- bonds and breaches

indexer.onEvent({ contract: "BondVault", event: "BondPosted" }, async ({ event, context }) => {
  const id = event.params.account.toLowerCase();
  const bond = await context.Bond.get(id);
  context.Bond.set({
    id,
    account_id: id,
    operator: event.params.operator,
    posted: (bond?.posted ?? 0n) + event.params.amount,
    withdrawn: bond?.withdrawn ?? 0n,
    slashed: bond?.slashed ?? 0n,
    balance: (bond?.balance ?? 0n) + event.params.amount,
    lastUpdatedBlock: BigInt(event.block.number),
  });
});

indexer.onEvent({ contract: "BondVault", event: "BondWithdrawn" }, async ({ event, context }) => {
  const bond = await context.Bond.get(event.params.account.toLowerCase());
  if (bond) {
    context.Bond.set({
      ...bond,
      withdrawn: bond.withdrawn + event.params.amount,
      balance: bond.balance - event.params.amount,
      lastUpdatedBlock: BigInt(event.block.number),
    });
  }
});

indexer.onEvent({ contract: "BondVault", event: "BreachFlagged" }, async ({ event, context }) => {
  const accountId = event.params.account.toLowerCase();
  context.Breach.set({
    id: event.params.breachId.toString(),
    account_id: accountId,
    ruleIndex: Number(event.params.ruleIndex),
    observed: event.params.observed,
    limit: event.params.limit,
    flaggedAtBlock: event.params.blockNumber,
    flaggedTxHash: event.transaction.hash,
    disputed: false,
    disputeReason: undefined,
    resolved: false,
    upheld: undefined,
    slashed: false,
    slashAmount: undefined,
    slashedAtBlock: undefined,
    paidTo: undefined,
  });
  const account = await context.Account.get(accountId);
  if (account) context.Account.set({ ...account, breaches: account.breaches + 1, closeOnly: true });
});

indexer.onEvent({ contract: "BondVault", event: "Disputed" }, async ({ event, context }) => {
  const breach = await context.Breach.get(event.params.breachId.toString());
  if (breach) context.Breach.set({ ...breach, disputed: true, disputeReason: event.params.reason });
});

indexer.onEvent({ contract: "BondVault", event: "DisputeResolved" }, async ({ event, context }) => {
  const breach = await context.Breach.get(event.params.breachId.toString());
  if (breach) context.Breach.set({ ...breach, resolved: true, upheld: event.params.upheld });
});

indexer.onEvent({ contract: "BondVault", event: "Slashed" }, async ({ event, context }) => {
  const breach = await context.Breach.get(event.params.breachId.toString());
  if (breach) {
    context.Breach.set({
      ...breach,
      slashed: true,
      slashAmount: event.params.amount,
      slashedAtBlock: BigInt(event.block.number),
      paidTo: event.params.backer,
    });
    const bond = await context.Bond.get(breach.account_id);
    if (bond) {
      context.Bond.set({
        ...bond,
        slashed: bond.slashed + event.params.amount,
        balance: bond.balance - event.params.amount,
        lastUpdatedBlock: BigInt(event.block.number),
      });
    }
  }
});
