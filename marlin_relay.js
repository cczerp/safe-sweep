const { ethers } = require("ethers");
const crypto = require("crypto");

/**
 * Marlin Relay Bundle Client for Polygon
 *
 * Implements Flashbots-style bundle submission to Marlin Relay
 * Endpoint: https://bor.txrelay.marlin.org
 *
 * Methods:
 * - eth_sendBundle: Submit transaction bundle
 * - eth_callBundle: Simulate bundle before submission
 *
 * Authentication:
 * - Uses searcher private key from MEV_SEARCHER_KEY env var
 * - Signs requests with X-Flashbots-Signature header
 * - Format: searcher_key_address:signature
 */
class MarlinRelay {
  constructor(config) {
    this.config = config;
    this.endpoint = "https://bor.txrelay.marlin.org";
    this.searcherKey = null;
    this.searcherAddress = null;
    
    console.log("🔷 Initializing Marlin Relay Client...");
    console.log(`   Endpoint: ${this.endpoint}`);
  }

  /**
   * Initialize with searcher private key
   */
  async initialize(searcherPrivateKey) {
    if (!searcherPrivateKey) {
      throw new Error("MEV_SEARCHER_KEY not provided - required for Marlin Relay");
    }

    // Create wallet from searcher key
    const searcherWallet = new ethers.Wallet(searcherPrivateKey);
    this.searcherKey = searcherPrivateKey;
    this.searcherAddress = searcherWallet.address;

    console.log(`   Searcher Address: ${this.searcherAddress}`);
    console.log("✅ Marlin Relay Client ready");
  }

  /**
   * Sign request body for authentication
   * Creates signature: keccak256(JSON.stringify(body))
   * Flashbots-style: address:signature
   */
  signRequest(body) {
    const bodyString = JSON.stringify(body);
    const messageHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(bodyString));
    const messageHashBytes = ethers.utils.arrayify(messageHash);
    
    // Create wallet from searcher key and sign
    const searcherWallet = new ethers.Wallet(this.searcherKey);
    const signature = searcherWallet._signingKey().signDigest(messageHashBytes);
    
    // Format: address:signature (r+s+v)
    const signatureHex = ethers.utils.joinSignature(signature);
    const authHeader = `${this.searcherAddress}:${signatureHex}`;
    
    return authHeader;
  }

  /**
   * Simulate bundle execution
   * NOTE: Not yet supported by Marlin Relay - kept for future use
   * 
   * @param {Array<string>} transactions - Array of signed transaction hex strings
   * @param {string|number} blockNumber - Target block number (hex or decimal)
   * @returns {Promise<Object>} Simulation result
   */
  async callBundle(transactions, blockNumber) {
    // Simulation not yet supported by Marlin Relay
    throw new Error("Bundle simulation not yet supported by Marlin Relay");
  }

  /**
   * Submit bundle to Marlin Relay
   * 
   * @param {Array<string>} transactions - Array of signed transaction hex strings
   * @param {string|number} blockNumber - Target block number (hex or decimal)
   * @returns {Promise<Object>} Submission result with bundleHash
   */
  async sendBundle(transactions, blockNumber) {
    const axios = require("axios");

    // Convert blockNumber to hex if needed
    const blockNumberHex = typeof blockNumber === "number" 
      ? "0x" + blockNumber.toString(16) 
      : blockNumber;

    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendBundle",
      params: [
        {
          txs: transactions,
          blockNumber: blockNumberHex
        }
      ]
    };

    // Sign request
    const signature = this.signRequest(body);

    try {
      const response = await axios.post(this.endpoint, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Flashbots-Signature": signature
        },
        timeout: 5000  // Reduced from 10s to 5s for faster fallback
      });

      if (response.data.error) {
        // Check if it's a network error vs invalid bundle
        const errorMsg = response.data.error.message || JSON.stringify(response.data.error);
        
        // Network/connection errors should trigger fallback
        if (errorMsg.includes("timeout") || 
            errorMsg.includes("ECONNREFUSED") || 
            errorMsg.includes("ENOTFOUND") ||
            errorMsg.includes("network")) {
          throw new Error(`NETWORK_ERROR: ${errorMsg}`);
        }
        
        // Invalid bundle errors should stop the sweep
        throw new Error(`INVALID_BUNDLE: ${errorMsg}`);
      }

      return {
        success: true,
        bundleHash: response.data.result?.bundleHash || response.data.result,
        result: response.data.result
      };
    } catch (error) {
      // Check if it's a network error
      if (error.code === "ECONNREFUSED" || 
          error.code === "ENOTFOUND" || 
          error.code === "ETIMEDOUT" ||
          error.message.includes("timeout") ||
          error.message.includes("NETWORK_ERROR")) {
        throw new Error(`NETWORK_ERROR: ${error.message}`);
      }

      // Re-throw other errors (invalid bundle, etc.)
      throw error;
    }
  }

  /**
   * Submit bundle (simulation not supported yet by Marlin)
   * 
   * @param {Array<string>} transactions - Array of signed transaction hex strings
   * @param {number} currentBlock - Current block number
   * @param {number} targetBlockOffset - Blocks ahead to target (default: 2)
   * @returns {Promise<Object>} Submission result
   */
  async submitBundleWithSimulation(transactions, currentBlock, targetBlockOffset = 2) {
    const targetBlock = currentBlock + targetBlockOffset;
    const targetBlockHex = "0x" + targetBlock.toString(16);

    console.log(`\n🔷 MARLIN RELAY BUNDLE SUBMISSION`);
    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Target block: ${targetBlock} (${targetBlockHex})`);
    console.log(`   Transactions: ${transactions.length}`);
    console.log(`   Note: Simulation not yet supported by Marlin Relay`);

    // Submit bundle directly (simulation skipped)
    console.log("\n🚀 Submitting bundle...");
    try {
      const result = await this.sendBundle(transactions, targetBlockHex);
      console.log("   ✅ Bundle submitted successfully");
      console.log(`   📦 Bundle Hash: ${result.bundleHash || "pending"}`);
      
      return {
        success: true,
        bundleHash: result.bundleHash,
        targetBlock: targetBlock,
        method: "marlin"
      };
    } catch (error) {
      if (error.message.includes("NETWORK_ERROR")) {
        throw error; // Re-throw network errors for fallback
      }
      console.error(`   ❌ Bundle submission failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = { MarlinRelay };

