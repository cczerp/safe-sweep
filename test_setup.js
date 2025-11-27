/**
 * Setup Test Script
 *
 * Run this to verify your configuration is correct
 * before running the live monitor.
 *
 * Usage: node test_setup.js
 */

const { ethers } = require("ethers");
const { UltraFastSweeper } = require("./ultra_fast_sweeper");
const { DynamicGasBidder } = require("./dynamic_gas_bidder");
require("dotenv").config();

/**
 * Validate if URL is a proper WebSocket URL
 */
function isWebSocketUrl(url) {
  return typeof url === "string" && (url.startsWith("wss://") || url.startsWith("ws://"));
}

// Test configuration
const CONFIG = {
  sweeperAddress: process.env.SWEEPER_MODULE,
  rpcUrl: process.env.ALCHEMY_HTTP || process.env.RPC_URL,
  quicknodeHttp: process.env.QUICKNODE_HTTP,
  quicknodeWss: process.env.QUICKNODE_WSS,
  alchemyHttp: process.env.ALCHEMY_HTTP,
  alchemyWss: process.env.ALCHEMY_WSS,
  infuraHttp: process.env.INFURA_HTTP,
  ankrHttp: process.env.ANKR_HTTP,
  nodiesHttp: process.env.NODIES_HTTP,
  bloxrouteHeader: process.env.BLOXROUTE_HEADER,
  privateKey: process.env.PRIVATE_KEY,
  vaultAddress: process.env.VAULT_ADDRESS,
  safeAddress: process.env.SAFE_ADDRESS,
  usdtContract: process.env.USDT_CONTRACT,
  chainId: parseInt(process.env.CHAIN_ID) || 137,
  dryRun: true, // Always dry run for tests
  debug: true,
  emergencyGasMult: parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 3.5,
  gasPremium: parseFloat(process.env.GAS_PREMIUM) || 0.5,
  poolSize: parseInt(process.env.POOL_SIZE) || 5,
  gasRefreshInterval: parseInt(process.env.GAS_REFRESH_INTERVAL) || 12000,
};

class SetupTester {
  constructor() {
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

  async runTests() {
    console.log("🧪 SETUP VERIFICATION TEST\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Test 1: Environment Variables
    await this.testEnvironmentVariables();

    // Test 2: RPC Connections
    await this.testRPCConnections();

    // Test 3: WebSocket Connections
    await this.testWebSocketConnections();

    // Test 4: BloxRoute
    await this.testBloxRoute();

    // Test 5: Wallet & Balance
    await this.testWallet();

    // Test 6: Smart Contracts
    await this.testSmartContracts();

    // Test 7: Pre-Signed Pool
    await this.testPreSignedPool();

    // Test 8: Dynamic Gas Bidder
    await this.testDynamicGasBidder();

    // Summary
    this.printSummary();
  }

  async testEnvironmentVariables() {
    console.log("\n📋 Test 1: Environment Variables\n");

    const requiredVars = [
      "SAFE_ADDRESS",
      "VAULT_ADDRESS",
      "SWEEPER_MODULE",
      "USDT_CONTRACT",
      "PRIVATE_KEY",
    ];

    for (const varName of requiredVars) {
      if (process.env[varName]) {
        this.pass(`${varName} is set`);
      } else {
        this.fail(`${varName} is MISSING`);
      }
    }

    // Optional but recommended
    const optionalVars = [
      "ALCHEMY_HTTP",
      "QUICKNODE_WSS",
      "BLOXROUTE_HEADER",
    ];

    for (const varName of optionalVars) {
      if (process.env[varName]) {
        this.pass(`${varName} is set (recommended)`);
      } else {
        this.warn(`${varName} is missing (recommended for best performance)`);
      }
    }
  }

  async testRPCConnections() {
    console.log("\n🌐 Test 2: RPC Connections\n");

    const rpcEndpoints = [
      { name: "Primary RPC", url: CONFIG.rpcUrl },
      { name: "Alchemy HTTP", url: CONFIG.alchemyHttp },
      { name: "QuickNode HTTP", url: CONFIG.quicknodeHttp },
      { name: "Infura HTTP", url: CONFIG.infuraHttp },
      { name: "Ankr HTTP", url: CONFIG.ankrHttp },
    ];

    for (const endpoint of rpcEndpoints) {
      if (!endpoint.url) {
        this.info(`${endpoint.name}: Not configured`);
        continue;
      }

      try {
        const provider = new ethers.providers.JsonRpcProvider(endpoint.url);
        const network = await provider.getNetwork();
        this.pass(`${endpoint.name}: Connected (Chain ${network.chainId})`);
      } catch (error) {
        this.fail(`${endpoint.name}: Failed - ${error.message}`);
      }
    }
  }

  async testWebSocketConnections() {
    console.log("\n🔌 Test 3: WebSocket Connections\n");

    const wsEndpoints = [
      { name: "QuickNode WSS", url: CONFIG.quicknodeWss },
      { name: "Alchemy WSS", url: CONFIG.alchemyWss },
    ];

    for (const endpoint of wsEndpoints) {
      if (!endpoint.url) {
        this.info(`${endpoint.name}: Not configured`);
        continue;
      }

      // Validate WebSocket URL format
      if (!isWebSocketUrl(endpoint.url)) {
        this.fail(`${endpoint.name}: Invalid URL (must start with wss:// or ws://)`);
        console.log(`   Got: ${endpoint.url.substring(0, 50)}...`);
        continue;
      }

      try {
        const provider = new ethers.providers.WebSocketProvider(endpoint.url);

        // Add error handler to prevent crashes
        provider._websocket.on("error", (err) => {
          console.error(`   Error: ${err.message}`);
        });

        await provider.getNetwork();
        this.pass(`${endpoint.name}: Connected`);
        provider.destroy();
      } catch (error) {
        this.fail(`${endpoint.name}: Failed - ${error.message}`);
      }
    }
  }

  async testBloxRoute() {
    console.log("\n⚡ Test 4: BloxRoute Connection\n");

    if (!CONFIG.bloxrouteHeader) {
      this.warn("BLOXROUTE_HEADER not set - will use standard RPC only");
      this.info("BloxRoute significantly improves speed - highly recommended");
      return;
    }

    const WebSocket = require("ws");

    return new Promise((resolve) => {
      try {
        const ws = new WebSocket("wss://api.blxrbdn.com/ws", {
          headers: {
            Authorization: CONFIG.bloxrouteHeader,
          },
        });

        ws.on("open", () => {
          this.pass("BloxRoute WebSocket: Connected");
          ws.close();
          resolve();
        });

        ws.on("error", (error) => {
          this.fail(`BloxRoute WebSocket: ${error.message}`);
          resolve();
        });

        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            this.fail("BloxRoute WebSocket: Connection timeout");
            ws.close();
            resolve();
          }
        }, 5000);
      } catch (error) {
        this.fail(`BloxRoute WebSocket: ${error.message}`);
        resolve();
      }
    });
  }

  async testWallet() {
    console.log("\n👛 Test 5: Wallet & Balance\n");

    try {
      const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
      const wallet = new ethers.Wallet(CONFIG.privateKey, provider);

      this.pass(`Wallet address: ${wallet.address}`);

      // Check MATIC balance
      const balance = await provider.getBalance(wallet.address);
      const maticBalance = ethers.utils.formatEther(balance);

      if (balance.gt(ethers.utils.parseEther("0.1"))) {
        this.pass(`MATIC balance: ${maticBalance} (sufficient for gas)`);
      } else {
        this.warn(
          `MATIC balance: ${maticBalance} (might be low for gas fees)`
        );
      }
    } catch (error) {
      this.fail(`Wallet test failed: ${error.message}`);
    }
  }

  async testSmartContracts() {
    console.log("\n📜 Test 6: Smart Contract Connections\n");

    try {
      const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);

      // Test sweeper contract
      const sweeperCode = await provider.getCode(CONFIG.sweeperAddress);
      if (sweeperCode !== "0x") {
        this.pass("Sweeper module contract found");
      } else {
        this.fail("Sweeper module contract NOT found at address");
      }

      // Test Safe
      const safeCode = await provider.getCode(CONFIG.safeAddress);
      if (safeCode !== "0x") {
        this.pass("Safe wallet contract found");
      } else {
        this.fail("Safe wallet contract NOT found at address");
      }

      // Test USDT
      const usdtCode = await provider.getCode(CONFIG.usdtContract);
      if (usdtCode !== "0x") {
        this.pass("USDT contract found");
      } else {
        this.fail("USDT contract NOT found at address");
      }
    } catch (error) {
      this.fail(`Smart contract test failed: ${error.message}`);
    }
  }

  async testPreSignedPool() {
    console.log("\n🎯 Test 7: Pre-Signed Transaction Pool\n");

    try {
      const sweeper = new UltraFastSweeper(CONFIG);
      await sweeper.initialize();

      const poolStats = sweeper.preSignedPool.getPoolStats();

      this.pass(
        `USDT pool: ${poolStats.usdt.available}/${poolStats.usdt.total} ready`
      );
      this.pass(
        `MATIC pool: ${poolStats.matic.available}/${poolStats.matic.total} ready`
      );
      this.pass(`Base nonce: ${poolStats.baseNonce}`);

      this.info(`Pool will refresh every ${CONFIG.gasRefreshInterval}ms`);
    } catch (error) {
      this.fail(`Pre-signed pool test failed: ${error.message}`);
    }
  }

  async testDynamicGasBidder() {
    console.log("\n💰 Test 8: Dynamic Gas Bidder\n");

    try {
      const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
      const bidder = new DynamicGasBidder(CONFIG);
      await bidder.initialize(provider, CONFIG.privateKey);

      this.pass("Dynamic Gas Bidder initialized");
      this.pass(`Gas premium: +${(CONFIG.gasPremium * 100).toFixed(0)}%`);

      // Test gas calculation
      const testAttackerGas = {
        type: 2,
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("30", "gwei"),
      };

      const outbidGas = bidder.calculateOutbidGas(testAttackerGas);
      const outbidAmount = ethers.utils.formatUnits(outbidGas.maxFeePerGas, "gwei");

      this.pass(
        `Test outbid: 100 gwei → ${outbidAmount} gwei (${(
          (parseFloat(outbidAmount) / 100 - 1) *
          100
        ).toFixed(0)}% increase)`
      );
    } catch (error) {
      this.fail(`Dynamic Gas Bidder test failed: ${error.message}`);
    }
  }

  printSummary() {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("📊 TEST SUMMARY\n");
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`⚠️ Warnings: ${this.warnings}`);

    if (this.failed === 0) {
      console.log("\n🎉 ALL CRITICAL TESTS PASSED!");
      console.log("✅ Your setup is ready for live monitoring");

      if (this.warnings > 0) {
        console.log(
          "\n⚠️ You have some warnings - consider addressing them for optimal performance"
        );
      }

      console.log("\n🚀 Next steps:");
      console.log("   1. Review warnings above (if any)");
      console.log("   2. Test with DRY_RUN=true first");
      console.log("   3. Run: node ultimate_defense_monitor.js");
    } else {
      console.log("\n❌ SETUP HAS ISSUES");
      console.log("⚠️ Fix failed tests before running live monitor");
      console.log("\n🔧 Check:");
      console.log("   1. .env file configuration");
      console.log("   2. Contract addresses are correct");
      console.log("   3. RPC endpoints are valid");
      console.log("   4. Wallet has MATIC for gas");
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }
}

// Run tests
async function main() {
  const tester = new SetupTester();
  await tester.runTests();
  process.exit(tester.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Test script failed:", error);
    process.exit(1);
  });
}

module.exports = { SetupTester };
