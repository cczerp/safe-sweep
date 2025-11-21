import { ethers } from 'ethers';
import { Logger } from '../utils/logger';
import { PendingTransaction } from '../types';

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger: Logger;
  private isMonitoring: boolean = false;

  constructor(wsUrl: string) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.logger = new Logger('MempoolMonitor');
  }

  async start(callback: (tx: PendingTransaction) => Promise<void>) {
    if (this.isMonitoring) {
      this.logger.warn('Already monitoring mempool');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting mempool monitoring...');

    this.provider.on('pending', async (txHash: string) => {
      try {
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;

        const pendingTx: PendingTransaction = {
          hash: tx.hash,
          from: tx.from,
          to: tx.to || '',
          data: tx.data,
          value: tx.value.toString(),
          gasPrice: tx.gasPrice?.toString(),
          maxFeePerGas: tx.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
        };

        await callback(pendingTx);
      } catch (error) {
        // Most errors are expected (tx replaced, rate limiting, etc.)
        // Only log critical errors
        if (error instanceof Error) {
          if (error.message.includes('network') || error.message.includes('connection')) {
            this.logger.error('Network error while fetching transaction:', error.message);
          }
          // Rate limiting and other transient errors are silently skipped
        }
      }
    });

    this.logger.success('Mempool monitoring started');
  }

  async stop() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    this.provider.removeAllListeners('pending');
    await this.provider.destroy();
    this.logger.info('Mempool monitoring stopped');
  }
}
