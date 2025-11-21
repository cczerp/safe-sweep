import { ethers } from 'ethers';
import Safe, { EthersAdapter } from '@safe-global/protocol-kit';
import { Logger } from '../utils/logger';
import { SuspiciousTransaction } from '../types';

export class TokenSweeper {
  private provider: ethers.Provider;
  private signer: ethers.Wallet;
  private safeAddress: string;
  private moduleAddress: string;
  private gasMultiplier: number;
  private logger: Logger;
  private isSweeping: boolean = false;

  constructor(
    provider: ethers.Provider,
    ownerPrivateKey: string,
    safeAddress: string,
    moduleAddress: string,
    gasMultiplier: number = 1.5
  ) {
    this.provider = provider;
    this.signer = new ethers.Wallet(ownerPrivateKey, provider);
    this.safeAddress = safeAddress;
    this.moduleAddress = moduleAddress;
    this.gasMultiplier = gasMultiplier;
    this.logger = new Logger('TokenSweeper');
  }

  async sweep(suspiciousTx: SuspiciousTransaction): Promise<boolean> {
    if (this.isSweeping) {
      this.logger.warn('Already sweeping tokens, skipping...');
      return false;
    }

    this.isSweeping = true;

    try {
      this.logger.warn('🚨 INITIATING EMERGENCY TOKEN SWEEP! 🚨');
      this.logger.info(`Reason: ${suspiciousTx.reason}`);

      // Get all tokens from the suspicious transaction
      const tokensToSweep = suspiciousTx.tokenTransfers.map(
        transfer => transfer.tokenAddress
      );

      // Sweep each token
      for (const tokenAddress of tokensToSweep) {
        await this.sweepToken(tokenAddress, suspiciousTx.tx.gasPrice);
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to sweep tokens:', error);
      return false;
    } finally {
      this.isSweeping = false;
    }
  }

  private async sweepToken(
    tokenAddress: string,
    suspiciousGasPrice?: string
  ): Promise<void> {
    this.logger.info(`Sweeping token ${tokenAddress}...`);

    // ERC20 ABI for balance and transfer
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
    ];

    const tokenContract = new ethers.Contract(
      tokenAddress,
      erc20Abi,
      this.provider
    );

    try {
      // Get token info
      const [balance, symbol, decimals] = await Promise.all([
        tokenContract.balanceOf(this.safeAddress),
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.decimals().catch(() => 18),
      ]);

      if (balance === 0n) {
        this.logger.info(`No balance for token ${symbol}, skipping...`);
        return;
      }

      this.logger.info(
        `Found ${ethers.formatUnits(balance, decimals)} ${symbol} to sweep`
      );

      // Create the sweep transaction through Safe
      await this.executeSafeSweep(tokenAddress, balance, suspiciousGasPrice);

      this.logger.success(
        `Successfully swept ${ethers.formatUnits(balance, decimals)} ${symbol}`
      );
    } catch (error) {
      this.logger.error(`Failed to sweep token ${tokenAddress}:`, error);
      throw error;
    }
  }

  private async executeSafeSweep(
    tokenAddress: string,
    amount: bigint,
    suspiciousGasPrice?: string
  ): Promise<void> {
    try {
      // Initialize Safe SDK
      const ethAdapter = new EthersAdapter({
        ethers,
        signerOrProvider: this.signer,
      });

      const safe = await Safe.create({
        ethAdapter,
        safeAddress: this.safeAddress,
      });

      // Create transaction to transfer tokens to the module
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)',
      ]);

      const data = erc20Interface.encodeFunctionData('transfer', [
        this.moduleAddress,
        amount,
      ]);

      const safeTransaction = await safe.createTransaction({
        transactions: [
          {
            to: tokenAddress,
            value: '0',
            data: data,
          },
        ],
      });

      // Sign the transaction
      const signedTx = await safe.signTransaction(safeTransaction);

      // Calculate gas price (higher than suspicious transaction)
      let gasPrice: bigint;
      if (suspiciousGasPrice) {
        gasPrice = BigInt(suspiciousGasPrice);
        gasPrice = (gasPrice * BigInt(Math.floor(this.gasMultiplier * 100))) / 100n;
      } else {
        const feeData = await this.provider.getFeeData();
        gasPrice = feeData.gasPrice || 0n;
        gasPrice = (gasPrice * BigInt(Math.floor(this.gasMultiplier * 100))) / 100n;
      }

      this.logger.info(`Using gas price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);

      // Execute the transaction
      const executeTxResponse = await safe.executeTransaction(signedTx, {
        gasPrice: gasPrice.toString(),
      });

      this.logger.info(`Sweep transaction submitted: ${executeTxResponse.hash}`);

      // Wait for confirmation
      const receipt = await executeTxResponse.transactionResponse?.wait();
      
      if (receipt?.status === 1) {
        this.logger.success('Sweep transaction confirmed!');
      } else {
        throw new Error('Sweep transaction failed');
      }
    } catch (error) {
      this.logger.error('Failed to execute Safe sweep:', error);
      throw error;
    }
  }
}
