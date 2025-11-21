import { ethers } from 'ethers';
import { Logger } from '../utils/logger';
import { PendingTransaction, SuspiciousTransaction } from '../types';

export class TransactionAnalyzer {
  private logger: Logger;
  private safeAddress: string;
  private authorizedAddresses: Set<string>;

  // ERC20 transferFrom function signature
  private readonly TRANSFER_FROM_SIG = '0x23b872dd';
  // ERC20 transfer function signature (also monitor this)
  private readonly TRANSFER_SIG = '0xa9059cbb';

  constructor(safeAddress: string, authorizedAddresses: string[]) {
    this.logger = new Logger('TransactionAnalyzer');
    this.safeAddress = safeAddress.toLowerCase();
    this.authorizedAddresses = new Set(
      authorizedAddresses.map(addr => addr.toLowerCase())
    );
  }

  async analyze(tx: PendingTransaction): Promise<SuspiciousTransaction | null> {
    // Check if transaction has data (contract interaction)
    if (!tx.data || tx.data.length < 10) {
      return null;
    }

    const functionSig = tx.data.slice(0, 10).toLowerCase();

    // Check if it's a transferFrom call
    if (functionSig === this.TRANSFER_FROM_SIG) {
      return this.analyzeTransferFrom(tx);
    }

    // Check if it's a direct transfer to potentially drain tokens
    if (functionSig === this.TRANSFER_SIG) {
      return this.analyzeTransfer(tx);
    }

    return null;
  }

  private analyzeTransferFrom(tx: PendingTransaction): SuspiciousTransaction | null {
    try {
      // Decode transferFrom(address from, address to, uint256 amount)
      const iface = new ethers.Interface([
        'function transferFrom(address from, address to, uint256 amount)',
      ]);

      const decoded = iface.parseTransaction({ data: tx.data });
      if (!decoded) return null;

      const [from, to, amount] = decoded.args;
      const fromAddress = from.toLowerCase();

      // Check if the 'from' address is our Safe
      if (fromAddress !== this.safeAddress) {
        return null;
      }

      // Check if the transaction sender is authorized
      const senderAddress = tx.from.toLowerCase();
      if (this.authorizedAddresses.has(senderAddress)) {
        this.logger.debug(`Authorized transferFrom detected from ${senderAddress}`);
        return null;
      }

      // This is a suspicious transaction!
      this.logger.warn(`SUSPICIOUS transferFrom detected!`);
      this.logger.warn(`  TX Hash: ${tx.hash}`);
      this.logger.warn(`  Sender: ${tx.from} (UNAUTHORIZED)`);
      this.logger.warn(`  Token: ${tx.to}`);
      this.logger.warn(`  From: ${from} (Our Safe)`);
      this.logger.warn(`  To: ${to}`);
      this.logger.warn(`  Amount: ${amount.toString()}`);

      return {
        tx,
        reason: `Unauthorized transferFrom from Safe by ${tx.from}`,
        tokenTransfers: [
          {
            tokenAddress: tx.to,
            from: from,
            to: to,
            amount: amount.toString(),
          },
        ],
      };
    } catch (error) {
      // Failed to decode, not a standard transferFrom
      return null;
    }
  }

  private analyzeTransfer(tx: PendingTransaction): SuspiciousTransaction | null {
    try {
      // Check if the transaction is TO our Safe address
      if (tx.to?.toLowerCase() !== this.safeAddress) {
        return null;
      }

      // Decode transfer(address to, uint256 amount)
      const iface = new ethers.Interface([
        'function transfer(address to, uint256 amount)',
      ]);

      const decoded = iface.parseTransaction({ data: tx.data });
      if (!decoded) return null;

      // This would be a transaction trying to call transfer on the Safe itself
      // which doesn't make sense for normal operations
      this.logger.debug(`Transfer call to Safe detected from ${tx.from}`);
      return null;
    } catch (error) {
      return null;
    }
  }
}
