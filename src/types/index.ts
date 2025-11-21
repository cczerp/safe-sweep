export interface Config {
  rpcUrl: string;
  safeAddress: string;
  moduleAddress: string;
  ownerPrivateKey: string;
  authorizedAddresses: string[];
  checkIntervalMs: number;
  gasMultiplier: number;
  maxGasPrice?: string;
}

export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  data: string;
  value: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface TokenTransfer {
  tokenAddress: string;
  from: string;
  to: string;
  amount: string;
}

export interface SuspiciousTransaction {
  tx: PendingTransaction;
  reason: string;
  tokenTransfers: TokenTransfer[];
}
