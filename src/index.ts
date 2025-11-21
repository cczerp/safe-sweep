import { ethers } from 'ethers';
import { MempoolMonitor } from './services/MempoolMonitor';
import { TransactionAnalyzer } from './services/TransactionAnalyzer';
import { TokenSweeper } from './services/TokenSweeper';
import { loadConfig } from './utils/config';
import { Logger } from './utils/logger';
import { PendingTransaction } from './types';

class SafeSweepBot {
  private config = loadConfig();
  private logger = new Logger('SafeSweepBot');
  private mempoolMonitor!: MempoolMonitor;
  private transactionAnalyzer!: TransactionAnalyzer;
  private tokenSweeper!: TokenSweeper;
  private provider!: ethers.Provider;

  async initialize() {
    this.logger.info('Initializing Safe Sweep Bot...');
    this.logger.info(`Safe Address: ${this.config.safeAddress}`);
    this.logger.info(`Module Address: ${this.config.moduleAddress}`);
    this.logger.info(
      `Authorized Addresses: ${this.config.authorizedAddresses.join(', ') || 'None'}`
    );

    // Convert HTTP RPC to WebSocket for mempool monitoring
    const wsUrl = this.config.rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    this.mempoolMonitor = new MempoolMonitor(wsUrl);
    
    this.transactionAnalyzer = new TransactionAnalyzer(
      this.config.safeAddress,
      this.config.authorizedAddresses
    );

    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);

    this.tokenSweeper = new TokenSweeper(
      this.provider,
      this.config.ownerPrivateKey,
      this.config.safeAddress,
      this.config.moduleAddress,
      this.config.gasMultiplier
    );

    this.logger.success('Bot initialized successfully');
  }

  async start() {
    this.logger.info('Starting Safe Sweep Bot...');
    this.logger.info('Monitoring mempool for suspicious transactions...');
    this.logger.warn('⚠️  Bot is now protecting your Safe from unauthorized transfers');

    await this.mempoolMonitor.start(async (tx: PendingTransaction) => {
      await this.handlePendingTransaction(tx);
    });

    // Keep the process running
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Received SIGTERM, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    });
  }

  private async handlePendingTransaction(tx: PendingTransaction) {
    try {
      const suspiciousTx = await this.transactionAnalyzer.analyze(tx);

      if (suspiciousTx) {
        this.logger.warn('🚨 ALERT: Suspicious transaction detected! 🚨');
        this.logger.warn(`Transaction Hash: ${tx.hash}`);
        this.logger.warn(`Reason: ${suspiciousTx.reason}`);

        // Immediately sweep tokens
        const success = await this.tokenSweeper.sweep(suspiciousTx);

        if (success) {
          this.logger.success('✅ Successfully protected Safe by sweeping tokens!');
        } else {
          this.logger.error('❌ Failed to sweep tokens - manual intervention required!');
        }
      }
    } catch (error) {
      // Log but don't crash the bot
      this.logger.error('Error handling pending transaction:', error);
    }
  }

  async stop() {
    this.logger.info('Stopping Safe Sweep Bot...');
    await this.mempoolMonitor.stop();
    this.logger.success('Bot stopped');
  }
}

// Main execution
async function main() {
  const bot = new SafeSweepBot();
  
  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
