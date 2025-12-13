const { ethers } = require("ethers");

/**
 * Nonce Cancellation Strategy
 * 
 * When we detect an attack, we can send a transaction with the SAME nonce
 * as the attacker but with higher gas. This creates a "race" where:
 * 1. If our tx wins: Attacker's tx is cancelled (nonce already used)
 * 2. This can buy us time to execute the actual sweep
 * 
 * Strategy:
 * - Send a high-gas "dummy" tx (just send 0 ETH to ourselves) with same nonce
 * - Then immediately send the actual sweep with next nonce
 * - The dummy tx blocks/delays the attacker
 */
class NonceCancellation {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.signer = null;
    
    console.log("🚫 Nonce Cancellation Strategy initialized");
    console.log("   Strategy: Send competing tx with same nonce to cancel attacker");
  }

  async initialize(provider, privateKey) {
    this.provider = provider;
    this.signer = new ethers.Wallet(privateKey, provider);
    console.log(`✅ Nonce Cancellation ready (wallet: ${this.signer.address})`);
  }

  /**
   * Send a high-gas transaction to ourselves with the SAME nonce as attacker
   * This attempts to cancel the attacker's pending transaction
   * 
   * @param {number} targetNonce - The nonce to use (should match attacker's if possible)
   * @param {object} attackerGas - Attacker's gas prices to outbid
   * @returns {object} Transaction response
   */
  async sendCancellationTx(targetNonce, attackerGas = null) {
    const startTime = Date.now();
    console.log(`\n🚫 NONCE CANCELLATION: Sending blocking tx with nonce ${targetNonce}`);

    try {
      // Get current gas prices
      const feeData = await this.provider.getFeeData();
      
      // Calculate competitive gas - either outbid attacker or use emergency gas
      let gasParams;
      if (attackerGas && attackerGas.maxFeePerGas) {
        // Outbid attacker by 200% for guaranteed priority
        const multiplier = 3; // 3x attacker's gas
        gasParams = {
          maxFeePerGas: attackerGas.maxFeePerGas.mul(multiplier),
          maxPriorityFeePerGas: attackerGas.maxPriorityFeePerGas.mul(multiplier),
          type: 2,
        };
        console.log(`   Outbidding attacker by ${multiplier}x`);
      } else if (attackerGas && attackerGas.gasPrice) {
        // Legacy gas
        const multiplier = 3;
        gasParams = {
          gasPrice: attackerGas.gasPrice.mul(multiplier),
          type: 0,
        };
        console.log(`   Outbidding attacker by ${multiplier}x (legacy)`);
      } else {
        // Use very high emergency gas
        const emergencyTip = ethers.utils.parseUnits("500", "gwei"); // Very high tip
        const emergencyMaxFee = ethers.utils.parseUnits("1000", "gwei");
        gasParams = {
          maxFeePerGas: emergencyMaxFee,
          maxPriorityFeePerGas: emergencyTip,
          type: 2,
        };
        console.log(`   Using emergency gas (500 gwei tip)`);
      }

      // Create a dummy transaction (send 0 to ourselves or to our vault)
      // This consumes the nonce without doing anything harmful
      const tx = {
        to: this.config.vaultAddress || this.signer.address,
        value: 0, // Send 0 MATIC
        nonce: targetNonce,
        chainId: this.config.chainId,
        gasLimit: 21000, // Minimum gas for simple transfer
        ...gasParams,
      };

      console.log(`   To: ${tx.to}`);
      console.log(`   Nonce: ${tx.nonce}`);
      console.log(`   Gas: ${ethers.utils.formatUnits(gasParams.maxFeePerGas || gasParams.gasPrice, "gwei")} gwei`);

      if (this.config.dryRun) {
        console.log("🔍 DRY RUN - would send cancellation tx");
        return { isDryRun: true, nonce: targetNonce };
      }

      // Send the transaction
      const txResponse = await this.signer.sendTransaction(tx);
      
      const elapsed = Date.now() - startTime;
      console.log(`✅ Cancellation tx sent in ${elapsed}ms`);
      console.log(`   Hash: ${txResponse.hash}`);
      console.log(`   This should block/cancel any tx with nonce ${targetNonce}`);

      return txResponse;
    } catch (error) {
      console.error(`❌ Cancellation tx failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a replacement transaction with same nonce but higher gas
   * This is used to "replace" a stuck transaction
   * 
   * @param {object} originalTx - The original transaction to replace
   * @param {number} gasMultiplier - How much to increase gas by (default 1.5 = 50% increase)
   */
  async replacementTx(originalTx, gasMultiplier = 1.5) {
    console.log(`\n🔄 REPLACEMENT TX: Replacing tx with nonce ${originalTx.nonce}`);

    try {
      // Build replacement with higher gas
      let gasParams;
      if (originalTx.maxFeePerGas) {
        gasParams = {
          maxFeePerGas: originalTx.maxFeePerGas.mul(Math.floor(gasMultiplier * 100)).div(100),
          maxPriorityFeePerGas: originalTx.maxPriorityFeePerGas.mul(Math.floor(gasMultiplier * 100)).div(100),
          type: 2,
        };
      } else {
        gasParams = {
          gasPrice: originalTx.gasPrice.mul(Math.floor(gasMultiplier * 100)).div(100),
          type: 0,
        };
      }

      const tx = {
        to: originalTx.to,
        value: originalTx.value || 0,
        data: originalTx.data || "0x",
        nonce: originalTx.nonce,
        chainId: originalTx.chainId,
        gasLimit: originalTx.gasLimit,
        ...gasParams,
      };

      console.log(`   Increasing gas by ${gasMultiplier}x`);
      console.log(`   New gas: ${ethers.utils.formatUnits(gasParams.maxFeePerGas || gasParams.gasPrice, "gwei")} gwei`);

      if (this.config.dryRun) {
        console.log("🔍 DRY RUN - would send replacement tx");
        return { isDryRun: true, nonce: originalTx.nonce };
      }

      const txResponse = await this.signer.sendTransaction(tx);
      
      console.log(`✅ Replacement tx sent`);
      console.log(`   Hash: ${txResponse.hash}`);

      return txResponse;
    } catch (error) {
      console.error(`❌ Replacement tx failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Advanced strategy: Send multiple competing transactions
   * This floods the mempool with high-gas txs to block attacker
   * 
   * @param {number} baseNonce - Starting nonce
   * @param {number} count - Number of competing txs to send
   * @param {object} attackerGas - Attacker's gas to outbid
   */
  async floodStrategy(baseNonce, count = 3, attackerGas = null) {
    console.log(`\n🌊 FLOOD STRATEGY: Sending ${count} competing txs starting at nonce ${baseNonce}`);

    const promises = [];
    for (let i = 0; i < count; i++) {
      const nonce = baseNonce + i;
      promises.push(
        this.sendCancellationTx(nonce, attackerGas)
          .catch(err => {
            console.error(`   Tx ${i + 1} failed: ${err.message}`);
            return null;
          })
      );
    }

    const results = await Promise.all(promises);
    const successful = results.filter(r => r !== null);

    console.log(`✅ Flood complete: ${successful.length}/${count} txs sent`);
    return successful;
  }
}

module.exports = { NonceCancellation };
