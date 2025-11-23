/**
 * Deployment Verification Script
 *
 * Checks that your contracts are deployed and configured correctly
 * before running the defense system.
 *
 * Usage: node verify_deployment.js
 */

const { ethers } = require("ethers");
require("dotenv").config();

const SWEEPER_ABI = [
  "function safe() view returns (address)",
  "function vault() view returns (address)",
  "function owner() view returns (address)",
  "function isAuthorized(address) view returns (bool)",
  "function getSafeMaticBalance() view returns (uint256)",
  "function getVaultMaticBalance() view returns (uint256)",
  "function healthCheck() view returns (bool, uint256, uint256, address, address, address)",
];

const VAULT_ABI = [
  "function owner() view returns (address)",
  "function getMaticBalance() view returns (uint256)",
];

class DeploymentVerifier {
  constructor() {
    this.provider = null;
    this.sweeperContract = null;
    this.vaultContract = null;
    this.botWallet = null;

    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
  }

  log(emoji, message) {
    console.log(`${emoji} ${message}`);
  }

  pass(message) {
    this.log("✅", message);
    this.passed++;
  }

  fail(message) {
    this.log("❌", message);
    this.failed++;
  }

  warn(message) {
    this.log("⚠️", message);
    this.warnings++;
  }

  info(message) {
    this.log("ℹ️", message);
  }

  async verify() {
    console.log("🔍 DEPLOYMENT VERIFICATION\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Check environment variables
    await this.checkEnvironment();

    // Connect to network
    await this.connectProvider();

    // Verify contracts
    await this.verifyContracts();

    // Verify configuration
    await this.verifyConfiguration();

    // Verify authorization
    await this.verifyAuthorization();

    // Health check
    await this.healthCheck();

    // Summary
    this.printSummary();
  }

  async checkEnvironment() {
    console.log("📋 Step 1: Environment Variables\n");

    const required = [
      "SAFE_ADDRESS",
      "VAULT_ADDRESS",
      "SWEEPER_MODULE",
      "PRIVATE_KEY",
    ];

    for (const varName of required) {
      if (process.env[varName]) {
        this.pass(`${varName} is set`);
      } else {
        this.fail(`${varName} is MISSING - add to .env`);
      }
    }

    console.log();
  }

  async connectProvider() {
    console.log("🌐 Step 2: Network Connection\n");

    const rpcUrl = process.env.ALCHEMY_HTTP || process.env.RPC_URL;
    if (!rpcUrl) {
      this.fail("No RPC URL configured");
      return;
    }

    try {
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const network = await this.provider.getNetwork();
      this.pass(`Connected to chain ${network.chainId}`);

      if (network.chainId !== 137) {
        this.warn("Not Polygon Mainnet (expected chain ID 137)");
      }
    } catch (error) {
      this.fail(`Connection failed: ${error.message}`);
    }

    console.log();
  }

  async verifyContracts() {
    console.log("📜 Step 3: Contract Deployments\n");

    if (!this.provider) {
      this.fail("Provider not available - skipping");
      console.log();
      return;
    }

    // Check Vault
    try {
      const vaultCode = await this.provider.getCode(process.env.VAULT_ADDRESS);
      if (vaultCode !== "0x") {
        this.pass("Vault contract deployed");
        this.vaultContract = new ethers.Contract(
          process.env.VAULT_ADDRESS,
          VAULT_ABI,
          this.provider
        );
      } else {
        this.fail("Vault contract NOT deployed at address");
      }
    } catch (error) {
      this.fail(`Vault check failed: ${error.message}`);
    }

    // Check Sweeper
    try {
      const sweeperCode = await this.provider.getCode(
        process.env.SWEEPER_MODULE
      );
      if (sweeperCode !== "0x") {
        this.pass("DefensiveSweeper contract deployed");
        this.sweeperContract = new ethers.Contract(
          process.env.SWEEPER_MODULE,
          SWEEPER_ABI,
          this.provider
        );
      } else {
        this.fail("DefensiveSweeper contract NOT deployed at address");
      }
    } catch (error) {
      this.fail(`Sweeper check failed: ${error.message}`);
    }

    // Check Safe
    try {
      const safeCode = await this.provider.getCode(process.env.SAFE_ADDRESS);
      if (safeCode !== "0x") {
        this.pass("Safe wallet found");
      } else {
        this.fail("Safe wallet NOT found at address");
      }
    } catch (error) {
      this.fail(`Safe check failed: ${error.message}`);
    }

    console.log();
  }

  async verifyConfiguration() {
    console.log("⚙️ Step 4: Contract Configuration\n");

    if (!this.sweeperContract) {
      this.fail("Sweeper contract not available - skipping");
      console.log();
      return;
    }

    try {
      // Check Safe address
      const safe = await this.sweeperContract.safe();
      if (safe.toLowerCase() === process.env.SAFE_ADDRESS.toLowerCase()) {
        this.pass("Safe address configured correctly");
      } else {
        this.fail(
          `Safe address mismatch:\n   Expected: ${process.env.SAFE_ADDRESS}\n   Got: ${safe}`
        );
      }

      // Check Vault address
      const vault = await this.sweeperContract.vault();
      if (vault.toLowerCase() === process.env.VAULT_ADDRESS.toLowerCase()) {
        this.pass("Vault address configured correctly");
      } else {
        this.fail(
          `Vault address mismatch:\n   Expected: ${process.env.VAULT_ADDRESS}\n   Got: ${vault}`
        );
      }

      // Check Owner
      const owner = await this.sweeperContract.owner();
      this.info(`Sweeper owner: ${owner}`);
    } catch (error) {
      this.fail(`Configuration check failed: ${error.message}`);
    }

    console.log();
  }

  async verifyAuthorization() {
    console.log("🔐 Step 5: Bot Authorization\n");

    if (!this.sweeperContract) {
      this.fail("Sweeper contract not available - skipping");
      console.log();
      return;
    }

    try {
      // Get bot wallet address
      this.botWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
      this.info(`Bot wallet: ${this.botWallet.address}`);

      // Check if authorized
      const isAuth = await this.sweeperContract.isAuthorized(
        this.botWallet.address
      );
      if (isAuth) {
        this.pass("Bot is authorized to call sweeper");
      } else {
        this.fail("Bot is NOT authorized - run authorizeBot()");
      }

      // Check bot balance
      const balance = await this.provider.getBalance(this.botWallet.address);
      const maticBalance = parseFloat(ethers.utils.formatEther(balance));

      if (maticBalance > 0.1) {
        this.pass(`Bot has ${maticBalance.toFixed(4)} MATIC for gas`);
      } else {
        this.warn(
          `Bot has low MATIC: ${maticBalance.toFixed(4)} (need ~0.1+ for gas)`
        );
      }
    } catch (error) {
      this.fail(`Authorization check failed: ${error.message}`);
    }

    console.log();
  }

  async healthCheck() {
    console.log("🏥 Step 6: System Health Check\n");

    if (!this.sweeperContract) {
      this.fail("Sweeper contract not available - skipping");
      console.log();
      return;
    }

    try {
      const [isOwnerAuth, safeBalance, vaultBalance, owner, safe, vault] =
        await this.sweeperContract.healthCheck();

      this.info(`Owner authorized: ${isOwnerAuth ? "Yes" : "No"}`);
      this.info(`Safe MATIC: ${ethers.utils.formatEther(safeBalance)}`);
      this.info(`Vault MATIC: ${ethers.utils.formatEther(vaultBalance)}`);

      if (!isOwnerAuth) {
        this.warn("Owner not authorized on Safe");
      }

      // Check if there are funds to protect
      if (parseFloat(ethers.utils.formatEther(safeBalance)) > 0) {
        this.pass("Safe has MATIC to protect");
      } else {
        this.info("Safe has no MATIC (add funds to test)");
      }
    } catch (error) {
      this.fail(`Health check failed: ${error.message}`);
    }

    console.log();
  }

  printSummary() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("📊 VERIFICATION SUMMARY\n");
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`⚠️ Warnings: ${this.warnings}`);

    console.log();

    if (this.failed === 0) {
      console.log("🎉 ALL CHECKS PASSED!");
      console.log("✅ Your contracts are deployed and configured correctly");

      if (this.warnings > 0) {
        console.log(
          "\n⚠️ Address warnings above before going live"
        );
      }

      console.log("\n🚀 Next steps:");
      console.log("   1. Add DefensiveSweeper as a module to your Safe");
      console.log("   2. Fund your Safe with tokens to protect");
      console.log("   3. Run: node ultimate_defense_monitor_v2.js");
    } else {
      console.log("\n❌ DEPLOYMENT HAS ISSUES");
      console.log("⚠️ Fix failed checks before running the defense system");

      console.log("\n🔧 Common fixes:");
      console.log("   - Missing contracts: Deploy them using DEPLOYMENT_GUIDE.md");
      console.log("   - Not authorized: Call authorizeBot(BOT_ADDRESS)");
      console.log("   - Wrong addresses: Update .env with correct addresses");
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    process.exit(this.failed > 0 ? 1 : 0);
  }
}

// Run verification
async function main() {
  const verifier = new DeploymentVerifier();
  await verifier.verify();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  });
}

module.exports = { DeploymentVerifier };
