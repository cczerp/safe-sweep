const { ethers } = require("ethers");

/**
 * Nonce Cancellation Strategy
 * 
 * When we detect an attack, we send a high-gas transaction with OUR NEXT nonce
 * to create congestion and delay. This strategy:
 * 1. Sends a high-gas "dummy" tx (0 value to vault/self)
 * 2. This consumes a nonce slot with maximum priority
 * 3. Creates mempool congestion and delays attacker
 * 4. Buys time for our actual sweep to execute
 * 
 * Note: We use OUR nonce, not the attacker's. The goal is to fill the mempool
 * with high-priority transactions to create congestion and delay.
 */
class NonceCancellation {
  constructor(config) {
    this.config = config;
    this.provider = null;
    this.signer = null;
    
    // Configurable gas settings for cancellation
    this.cancellationGasMultiplier = config.cancellationGasMultiplier || 3; // 3x attacker's gas
    this.emergencyTipGwei = config.nonceCancellationTip || 500; // 500 gwei default
    this.emergencyMaxFeeGwei = config.nonceCancellationMaxFee || 1000; // 1000 gwei default
    
    console.log("🚫 Nonce Cancellation Strategy initialized");
    console.log(`   Gas Multiplier: ${this.cancellationGasMultiplier}x attacker's gas`);
    console.log(`   Emergency Tip: ${this.emergencyTipGwei} gwei`);
    console.log(`   Emergency Max Fee: ${this.emergencyMaxFeeGwei} gwei`);
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
        // Outbid attacker by configured multiplier with overflow protection
        const maxSafeGas = ethers.utils.parseUnits("10000", "gwei"); // 10k gwei cap
        const multipliedMaxFee = attackerGas.maxFeePerGas.mul(this.cancellationGasMultiplier);
        const multipliedTip = attackerGas.maxPriorityFeePerGas.mul(this.cancellationGasMultiplier);
        
        gasParams = {
          maxFeePerGas: multipliedMaxFee.gt(maxSafeGas) ? maxSafeGas : multipliedMaxFee,
          maxPriorityFeePerGas: multipliedTip.gt(maxSafeGas) ? maxSafeGas : multipliedTip,
          type: 2,
        };
        console.log(`   Outbidding attacker by ${this.cancellationGasMultiplier}x (capped at 10k gwei)`);
      } else if (attackerGas && attackerGas.gasPrice) {
        // Legacy gas with overflow protection
        const maxSafeGas = ethers.utils.parseUnits("10000", "gwei");
        const multipliedGas = attackerGas.gasPrice.mul(this.cancellationGasMultiplier);
        
        gasParams = {
          gasPrice: multipliedGas.gt(maxSafeGas) ? maxSafeGas : multipliedGas,
          type: 0,
        };
        console.log(`   Outbidding attacker by ${this.cancellationGasMultiplier}x (legacy, capped at 10k gwei)`);
      } else {
        // Use configured emergency gas
        const emergencyTip = ethers.utils.parseUnits(this.emergencyTipGwei.toString(), "gwei");
        const emergencyMaxFee = ethers.utils.parseUnits(this.emergencyMaxFeeGwei.toString(), "gwei");
        gasParams = {
          maxFeePerGas: emergencyMaxFee,
          maxPriorityFeePerGas: emergencyTip,
          type: 2,
        };
        console.log(`   Using emergency gas (${this.emergencyTipGwei} gwei tip)`);
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
      // Build replacement with higher gas using proper BigNumber arithmetic
      let gasParams;
      if (originalTx.maxFeePerGas) {
        // For 1.5x multiplier, use mul(15).div(10) for precise calculation
        const multiplierNum = Math.floor(gasMultiplier * 10);
        gasParams = {
          maxFeePerGas: originalTx.maxFeePerGas.mul(multiplierNum).div(10),
          maxPriorityFeePerGas: originalTx.maxPriorityFeePerGas.mul(multiplierNum).div(10),
          type: 2,
        };
      } else {
        const multiplierNum = Math.floor(gasMultiplier * 10);
        gasParams = {
          gasPrice: originalTx.gasPrice.mul(multiplierNum).div(10),
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
