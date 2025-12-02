const ethers = require("ethers");

/**
 * Approval Intelligence Tracker
 *
 * Monitors ERC20 Approval events on target contracts to build a "watch list"
 * of addresses that have been granted spending approval on your Safe.
 *
 * This provides advance intelligence on potential threats:
 * - Track WHO gets approved
 * - Track WHEN they got approved
 * - Track HOW MUCH they can spend
 * - Cross-reference with transferFrom attacks for context
 *
 * Uses eth_subscribe (premium tier) for real-time event monitoring.
 */
class ApprovalTracker {
  constructor(config) {
    this.config = config;
    this.watchList = new Map(); // address -> approval details
    this.provider = null;
    this.subscription = null;

    this.stats = {
      approvalsDetected: 0,
      activeApprovals: 0,
      suspiciousPatterns: 0,
    };
  }

  async initialize() {
    console.log("\n🔍 Initializing Approval Intelligence Tracker...");

    if (!this.config.drpcWss) {
      console.log("⚠️  No WebSocket configured - Approval tracking disabled");
      return false;
    }

    try {
      // Connect via WebSocket for eth_subscribe
      this.provider = new ethers.providers.WebSocketProvider(this.config.drpcWss);

      // Subscribe to Approval events on USDT contract
      // Event signature: Approval(address indexed owner, address indexed spender, uint256 value)
      const approvalTopic = ethers.utils.id("Approval(address,address,uint256)");
      const safeAddressPadded = ethers.utils.hexZeroPad(
        this.config.safeAddress.toLowerCase(),
        32
      );

      const filter = {
        address: this.config.usdtContract,
        topics: [
          approvalTopic,       // event signature
          safeAddressPadded,   // owner = your Safe
        ],
      };

      console.log(`   📡 Subscribing to Approval events on USDT...`);
      console.log(`   👀 Watching for approvals from: ${this.config.safeAddress}`);

      // Subscribe to logs matching the filter
      this.provider.on(filter, (log) => {
        this.handleApprovalEvent(log);
      });

      console.log("   ✅ Approval tracker active");

      // Check historical approvals (last ~2 days)
      await this.scanHistoricalApprovals();

      // CRITICAL: Also check for current allowances to known risky addresses
      await this.checkKnownRiskyAllowances();

      return true;
    } catch (error) {
      console.error("❌ Failed to initialize approval tracker:", error.message);
      return false;
    }
  }

  async scanHistoricalApprovals() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      // CRITICAL: Scan much more history - 100k blocks (~2 days on Polygon)
      // Most approvals that will be exploited were granted recently
      const fromBlock = Math.max(0, currentBlock - 100000);

      console.log(`   🔎 Scanning blocks ${fromBlock} to ${currentBlock} for existing approvals...`);
      console.log(`   ⚠️  This covers ~2 days of history on Polygon`);

      const approvalTopic = ethers.utils.id("Approval(address,address,uint256)");
      const safeAddressPadded = ethers.utils.hexZeroPad(
        this.config.safeAddress.toLowerCase(),
        32
      );

      const logs = await this.provider.getLogs({
        address: this.config.usdtContract,
        topics: [approvalTopic, safeAddressPadded],
        fromBlock: fromBlock,
        toBlock: currentBlock,
      });

      console.log(`   📊 Found ${logs.length} historical approvals`);

      for (const log of logs) {
        this.handleApprovalEvent(log, true); // true = historical
      }
    } catch (error) {
      console.error("   ⚠️  Historical scan failed:", error.message);
    }
  }

  async checkKnownRiskyAllowances() {
    try {
      console.log(`   🔍 Checking current on-chain allowances for known risky addresses...`);

      // Check allowances from approval events we found
      // For each spender in our watch list, verify current allowance on-chain
      const usdtContract = new ethers.Contract(
        this.config.usdtContract,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        this.provider
      );

      // Get all unique spenders from historical scan
      const spendersToCheck = Array.from(this.watchList.keys());

      if (spendersToCheck.length === 0) {
        console.log(`   ℹ️  No historical approvals found to verify`);
        return;
      }

      console.log(`   🔎 Verifying ${spendersToCheck.length} addresses...`);

      for (const spender of spendersToCheck) {
        try {
          const allowance = await usdtContract.allowance(this.config.safeAddress, spender);

          if (allowance.isZero()) {
            // Allowance was revoked, remove from watch list
            this.watchList.delete(spender);
          } else {
            // Update with current allowance
            const existing = this.watchList.get(spender);
            if (existing) {
              existing.amount = allowance.toString();
              existing.amountFormatted = ethers.utils.formatUnits(allowance, 6);
            }
          }
        } catch (error) {
          console.log(`   ⚠️  Failed to check allowance for ${spender}: ${error.message}`);
        }
      }

      this.stats.activeApprovals = this.watchList.size;
      console.log(`   ✅ Found ${this.watchList.size} active approvals on-chain`);

      if (this.watchList.size > 0) {
        console.log(`\n   ⚠️  ACTIVE APPROVALS DETECTED:`);
        for (const [address, details] of this.watchList.entries()) {
          console.log(`      ${address}: ${details.amountFormatted} USDT`);
        }
        console.log(`   👁️  These addresses are now being monitored for ANY activity!`);
      }
    } catch (error) {
      console.error(`   ⚠️  On-chain allowance check failed: ${error.message}`);
    }
  }

  handleApprovalEvent(log, isHistorical = false) {
    try {
      // Decode event: Approval(address indexed owner, address indexed spender, uint256 value)
      // topics[0] = event signature
      // topics[1] = owner (your Safe)
      // topics[2] = spender (approved address)
      // data = amount

      const spender = ethers.utils.getAddress("0x" + log.topics[2].slice(26));
      const amount = ethers.BigNumber.from(log.data);
      const amountFormatted = ethers.utils.formatUnits(amount, 6); // USDT has 6 decimals

      const approvalData = {
        spender: spender,
        amount: amount.toString(),
        amountFormatted: amountFormatted,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        timestamp: Date.now(),
        asset: "USDT",
      };

      // Check if this is a revocation (amount = 0)
      if (amount.isZero()) {
        if (this.watchList.has(spender)) {
          this.watchList.delete(spender);
          console.log(`\n✅ Approval REVOKED for ${spender}`);
          this.stats.activeApprovals = this.watchList.size;
        }
        return;
      }

      // Add to watch list
      this.watchList.set(spender, approvalData);
      this.stats.approvalsDetected++;
      this.stats.activeApprovals = this.watchList.size;

      if (!isHistorical) {
        console.log(`\n⚠️  NEW APPROVAL DETECTED`);
        console.log(`   Spender: ${spender}`);
        console.log(`   Amount: ${amountFormatted} USDT`);
        console.log(`   Block: ${log.blockNumber}`);
        console.log(`   TxHash: ${log.transactionHash}`);
        console.log(`   👁️  Now watching this address...`);
      }

      // Check for suspicious patterns
      this.analyzeSuspiciousPatterns(approvalData);
    } catch (error) {
      console.error("❌ Failed to process approval event:", error.message);
    }
  }

  analyzeSuspiciousPatterns(approvalData) {
    // Flag high-value approvals
    const amount = ethers.BigNumber.from(approvalData.amount);
    const threshold = ethers.utils.parseUnits("10000", 6); // 10k USDT

    if (amount.gt(threshold)) {
      console.log(`   🚨 HIGH VALUE APPROVAL: ${approvalData.amountFormatted} USDT!`);
      this.stats.suspiciousPatterns++;
    }

    // Flag max uint256 approvals (unlimited)
    if (amount.eq(ethers.constants.MaxUint256)) {
      console.log(`   🚨 UNLIMITED APPROVAL GRANTED!`);
      this.stats.suspiciousPatterns++;
    }
  }

  /**
   * Check if an address is on the watch list (has approval)
   */
  isWatchedAddress(address) {
    try {
      const normalized = ethers.utils.getAddress(address);
      return this.watchList.has(normalized);
    } catch {
      return false;
    }
  }

  /**
   * Get approval details for an address
   */
  getApprovalDetails(address) {
    try {
      const normalized = ethers.utils.getAddress(address);
      return this.watchList.get(normalized) || null;
    } catch {
      return null;
    }
  }

  /**
   * Get context string for logging
   */
  getContext(address) {
    const details = this.getApprovalDetails(address);
    if (!details) return null;

    const timeAgo = Math.floor((Date.now() - details.timestamp) / 1000);
    const timeStr = timeAgo < 60
      ? `${timeAgo}s ago`
      : timeAgo < 3600
        ? `${Math.floor(timeAgo / 60)}m ago`
        : `${Math.floor(timeAgo / 3600)}h ago`;

    return `Approved ${timeStr} for ${details.amountFormatted} ${details.asset} (block ${details.blockNumber})`;
  }

  getStats() {
    return {
      ...this.stats,
      watchListSize: this.watchList.size,
    };
  }

  printStatus() {
    console.log("\n📋 APPROVAL INTELLIGENCE:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
    const stats = this.getStats();
    console.log(`   Total Approvals Detected: ${stats.approvalsDetected}`);
    console.log(`   Active Watch List Size: ${stats.activeApprovals}`);
    console.log(`   Suspicious Patterns: ${stats.suspiciousPatterns}`);

    if (this.watchList.size > 0) {
      console.log("\n   🎯 Currently Watching:");
      for (const [address, details] of this.watchList.entries()) {
        console.log(`      ${address}: ${details.amountFormatted} ${details.asset}`);
      }
    }
  }

  async shutdown() {
    if (this.provider) {
      this.provider.removeAllListeners();
      await this.provider.destroy();
    }
  }
}

module.exports = { ApprovalTracker };
