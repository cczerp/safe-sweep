const { ethers } = require("ethers");
const { Alchemy, Network } = require("alchemy-sdk");
const fs = require("fs").promises;
const path = require("path");

// Load environment variables FIRST
require("dotenv").config();

// Import the optimized sweeper bot
const { CleanSweeperBot } = require("./sweeper_bot");

// DEBUG: Let's see what's actually loaded
console.log("🔍 Environment Debug:");
console.log(
  "  - ALCHEMY_HTTP:",
  process.env.ALCHEMY_HTTP ? "FOUND" : "MISSING"
);
console.log("  - ALCHEMY_KEY:", process.env.ALCHEMY_KEY ? "FOUND" : "MISSING");
console.log("  - ALCHEMY_WSS:", process.env.ALCHEMY_WSS ? "FOUND" : "MISSING");
console.log(
  "  - QUICKNODE_HTTP:",
  process.env.QUICKNODE_HTTP ? "FOUND" : "MISSING"
);
console.log(
  "  - QUICKNODE_WSS:",
  process.env.QUICKNODE_WSS ? "FOUND" : "MISSING"
);
console.log("  - INFURA_WSS:", process.env.INFURA_WSS ? "FOUND" : "MISSING");
console.log(
  "  - INFURA_GAS_API_KEY:",
  process.env.INFURA_GAS_API_KEY ? "FOUND" : "MISSING"
);
console.log(
  "  - BLOXROUTE_HEADER:",
  process.env.BLOXROUTE_HEADER ? "FOUND" : "MISSING"
);

// Safe SDK imports
const SafeSdk = require("@safe-global/safe-core-sdk").default;
const EthersAdapter = require("@safe-global/safe-ethers-lib").default;

// Configuration - Uses YOUR exact environment variable names
const CONFIG = {
  // Core addresses from your env
  sweeperAddress: process.env.SWEEPER_MODULE,
  vaultAddress: process.env.VAULT_ADDRESS,
  safeAddress: process.env.SAFE_ADDRESS,
  usdtContract: process.env.USDT_CONTRACT,
  privateKey: process.env.PRIVATE_KEY,

  // API keys from your env
  alchemyApiKey: process.env.ALCHEMY_KEY,
  infuraGasApiKey: process.env.INFURA_GAS_API_KEY,
  gasApiUrl: process.env.INFURA_GAS_API_URL || "https://gas.api.infura.io/v3",
  bloxrouteHeader: process.env.BLOXROUTE_HEADER,

  // RPC endpoints from your env
  rpcUrl: process.env.ALCHEMY_HTTP, // Primary RPC
  quicknodeHttp: process.env.QUICKNODE_HTTP,
  quicknodeWss: process.env.QUICKNODE_WSS,
  alchemyHttp: process.env.ALCHEMY_HTTP,
  alchemyWss: process.env.ALCHEMY_WSS,
  infuraHttp: process.env.INFURA_HTTP,
  infuraWss: process.env.INFURA_WSS,
  nodiesHttp: process.env.NODIES_HTTP,
  ankrHttp: process.env.ANKR_HTTP,

  // Settings from your env
  chainId: parseInt(process.env.CHAIN_ID) || 137,
  dryRun: process.env.DRY_RUN === "true",
  debug: process.env.DEBUG === "true",
  gasMult: parseFloat(process.env.MEMPOOL_GAS_MULTIPLIER) || 2.0,
  emergencyGasMult: parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 3.5,

  // System settings
  noncePersistPath:
    process.env.NONCE_PERSIST_PATH ||
    path.join(
      process.cwd(),
      `.nonce_${(process.env.PRIVATE_KEY || "anon").slice(-8)}.json`
    ),
  wsReconnectInterval: 15000,
  wsMaxReconnectAttempts: 15,
  wsProviders: ["quicknode", "alchemy", "infura"],
};

// Complete DefensiveSweeper ABI
const SWEEPER_ABI = [
  "function sweepMatic() external",
  "function sweepMaticAmount(uint256 amount) external",
  "function sweepAllMaticNow() external",
  "function sweepToken(address tokenAddress) external",
  "function sweepTokenAmount(address tokenAddress, uint256 amount) external",
  "function sendFromSafe(address token, address to, uint256 amount) external",
  "function emergencySweepAll() external",
  "function emergencySweepToken(address tokenAddress) external",
  "function batchSweepToVault(address[] tokens, uint256[] amounts) external",
  "function getTokenBalance(address token) external view returns (uint256)",
  "function isAuthorized(address user) external view returns (bool)",
  "function getSafeMaticBalance() external view returns (uint256)",
  "function getVaultMaticBalance() external view returns (uint256)",
  "function healthCheck() external view returns (bool, uint256, uint256, address, address, address)",
];

// USDT ABI for monitoring transfers
const USDT_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// ERC20 ABI for detecting any token transfers
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

/* Integrated Monitor Bot with Optimized Sweeper */
class IntegratedDefensiveBot {
  constructor(config) {
    this.config = config;
    console.log("🎯 Initializing Integrated Defensive Monitor Bot...");
    this.provider = null;
    this.wsProvider = null;
    this.alchemyTxProvider = null;
    this.currentWsProviderIndex = 0;
    this.wsReconnectAttempts = 0;
    this.gasCache = {
      data: null,
      timestamp: 0,
      ttl: 10000,
    };
    this.alchemy = null;
    this.signer = null;
    this.sweeperContract = null;
    this.usdtContract = null;
    this.ethAdapter = null;
    this.safeSdk = null;
    this.isMonitoring = false;

    // INTEGRATED SWEEPER BOT
    this.sweeperBot = null;
    this.sweeperReady = false;

    // Asset addresses for detection
    this.MATIC_ADDRESS = "0x0000000000000000000000000000000000000000";
    this.knownTokens = new Map();
  }

  async initialize() {
    try {
      console.log("🔧 Configuration Check:");
      console.log(`  - Safe Address: ${this.config.safeAddress}`);
      console.log(`  - Vault Address: ${this.config.vaultAddress}`);
      console.log(`  - Sweeper Module: ${this.config.sweeperAddress}`);
      console.log(`  - USDT Contract: ${this.config.usdtContract}`);
      console.log(
        `  - QuickNode WSS: ${
          this.config.quicknodeWss ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - Alchemy HTTP: ${
          this.config.alchemyHttp ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - Alchemy WSS: ${
          this.config.alchemyWss ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - Infura WSS: ${
          this.config.infuraWss ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - Infura Gas API: ${
          this.config.infuraGasApiKey ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - BloxRoute Header: ${
          this.config.bloxrouteHeader ? "✅ Available" : "❌ Missing"
        }`
      );
      console.log(
        `  - WebSocket Rotation: ${this.config.wsProviders.join(" → ")}`
      );
      console.log(`  - INTEGRATED MODE: ✅ Enabled`);
      console.log(`  - DRY RUN: ${this.config.dryRun}`);

      // Check required variables
      if (!this.config.rpcUrl)
        throw new Error("ALCHEMY_HTTP not found in environment variables");
      if (!this.config.alchemyApiKey)
        throw new Error("ALCHEMY_KEY not found in environment variables");
      if (!this.config.privateKey)
        throw new Error("PRIVATE_KEY not found in environment variables");
      if (!this.config.safeAddress)
        throw new Error("SAFE_ADDRESS not found in environment variables");
      if (!this.config.sweeperAddress)
        throw new Error("SWEEPER_MODULE not found in environment variables");
      if (!this.config.vaultAddress)
        throw new Error("VAULT_ADDRESS not found in environment variables");

      console.log("\n🔡 Connecting to primary HTTP RPC provider...");
      const network = {
        name: "polygon",
        chainId: 137,
      };
      this.provider = new ethers.providers.JsonRpcProvider(
        this.config.rpcUrl,
        network
      );

      const netInfo = await this.provider.getNetwork();
      console.log(`✅ Connected to primary RPC - Chain ID: ${netInfo.chainId}`);

      // Setup dedicated Alchemy provider for transactions
      await this.setupAlchemyTransactionProvider();

      // Setup WebSocket provider for monitoring (round-robin)
      await this.setupWebSocketProvider();

      console.log("🔗 Connecting to Alchemy SDK...");
      this.alchemy = new Alchemy({
        apiKey: this.config.alchemyApiKey,
        network: Network.MATIC_MAINNET,
      });
      console.log("✅ Connected to Alchemy SDK");

      console.log("🔑 Setting up wallet and signer...");
      this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
      console.log(`✅ Wallet initialized: ${this.signer.address}`);

      // Safe SDK setup
      try {
        this.ethAdapter = new EthersAdapter({
          ethers,
          signerOrProvider: this.signer,
        });
        this.safeSdk = await SafeSdk.create({
          ethAdapter: this.ethAdapter,
          safeAddress: this.config.safeAddress,
        });
        console.log("✅ Safe SDK initialized");
      } catch (e) {
        console.warn("⚠️ Safe SDK init failed:", e.message || e);
        this.safeSdk = null;
      }

      // Contract instances for monitoring only
      const monitoringProvider = this.getMonitoringProvider();
      this.sweeperContract = new ethers.Contract(
        this.config.sweeperAddress,
        SWEEPER_ABI,
        this.signer
      );

      this.usdtContract = new ethers.Contract(
        this.config.usdtContract,
        USDT_ABI,
        monitoringProvider
      );

      // Initialize known tokens
      this.knownTokens.set(this.config.usdtContract.toLowerCase(), "USDT");
      this.knownTokens.set(this.MATIC_ADDRESS, "MATIC");

      // INITIALIZE INTEGRATED SWEEPER BOT
      await this.setupIntegratedSweeper();

      // Verify authorization
      const isAuthorized = await this.sweeperContract.isAuthorized(
        this.signer.address
      );
      console.log(
        `Authorization Status: ${
          isAuthorized ? "✅ Authorized" : "❌ Not Authorized"
        }`
      );

      if (!isAuthorized) {
        console.warn("⚠️ Bot is not authorized on the sweeper module");
      }

      return true;
    } catch (error) {
      console.error("❌ Initialization failed:", error.message || error);
      throw error;
    }
  }

  // SETUP INTEGRATED SWEEPER BOT
  async setupIntegratedSweeper() {
    try {
      console.log("\n🔧 Setting up integrated BloxRoute sweeper bot...");

      // Create sweeper config optimized for emergency
      const sweeperConfig = {
        sweeperAddress: this.config.sweeperAddress,
        rpcUrl: this.config.alchemyHttp,
        bloxrouteHeader: this.config.bloxrouteHeader,
        privateKey: this.config.privateKey,
        vaultAddress: this.config.vaultAddress,
        safeAddress: this.config.safeAddress,
        usdtContract: this.config.usdtContract,
        chainId: this.config.chainId,
        dryRun: this.config.dryRun,
        debug: this.config.debug,
        gasMult: this.config.emergencyGasMult, // Use emergency gas for all sweeps
        noncePersistPath: this.config.noncePersistPath,
      };

      this.sweeperBot = new CleanSweeperBot(sweeperConfig);
      await this.sweeperBot.initialize();

      this.sweeperReady = true;
      console.log("✅ Integrated sweeper bot ready");

      // Log integration status
      console.log("\n🔗 Integration Status:");
      console.log(
        `  - Monitor: ${this.config.wsProviders.join(" → ")} WebSocket`
      );
      console.log(
        `  - Sweeper: ${
          this.sweeperBot.bloxrouteWs
            ? "BloxRoute private relay"
            : "Standard RPC"
        }`
      );
      console.log(`  - Emergency Gas: ${this.config.emergencyGasMult}x`);
      console.log(`  - Fallback: Alchemy direct`);
    } catch (error) {
      console.error("❌ Integrated sweeper setup failed:", error.message);
      console.log("⚠️ Will use direct sweep methods as fallback");
      this.sweeperReady = false;
    }
  }

  // DEDICATED ALCHEMY PROVIDER FOR TRANSACTIONS
  async setupAlchemyTransactionProvider() {
    if (!this.config.alchemyHttp) {
      console.warn(
        "⚠️ ALCHEMY_HTTP not available, using main RPC for transactions"
      );
      this.alchemyTxProvider = this.provider;
      return;
    }

    try {
      console.log("🔗 Setting up dedicated Alchemy transaction provider...");

      const network = {
        name: "polygon",
        chainId: 137,
      };
      this.alchemyTxProvider = new ethers.providers.JsonRpcProvider(
        this.config.alchemyHttp,
        network
      );

      // Test the connection
      await this.alchemyTxProvider.getNetwork();
      console.log("✅ Alchemy transaction provider ready");
    } catch (error) {
      console.warn(
        "⚠️ Alchemy transaction provider failed, using main RPC:",
        error.message
      );
      this.alchemyTxProvider = this.provider;
    }
  }

  // WEBSOCKET URL MANAGEMENT - Uses YOUR exact endpoints
  getWebSocketURL(providerType) {
    console.log(`🔍 Getting WebSocket URL for: ${providerType}`);

    switch (providerType) {
      case "quicknode":
        console.log(
          `   - QUICKNODE_WSS: ${this.config.quicknodeWss || "MISSING"}`
        );
        return this.config.quicknodeWss;

      case "alchemy":
        console.log(`   - ALCHEMY_WSS: ${this.config.alchemyWss || "MISSING"}`);
        return this.config.alchemyWss;

      case "infura":
        console.log(`   - INFURA_WSS: ${this.config.infuraWss || "MISSING"}`);
        return this.config.infuraWss;

      default:
        console.log(`   - Unknown provider type: ${providerType}`);
        return null;
    }
  }

  async setupWebSocketProvider() {
    const currentProvider =
      this.config.wsProviders[this.currentWsProviderIndex];
    const wsUrl = this.getWebSocketURL(currentProvider);

    console.log(`\n🔌 WebSocket Debug for ${currentProvider.toUpperCase()}:`);
    console.log(`   - Provider: ${currentProvider}`);
    console.log(`   - URL: ${wsUrl || "NULL/MISSING"}`);
    console.log(`   - Index: ${this.currentWsProviderIndex}`);

    if (!wsUrl) {
      console.log(
        `❌ ${currentProvider} websocket URL is null/missing, trying next...`
      );
      await this.rotateToNextWSProvider();
      return;
    }

    try {
      console.log(
        `🔌 Attempting connection to ${currentProvider.toUpperCase()}: ${wsUrl.substring(
          0,
          50
        )}...`
      );

      const network = {
        name: "polygon",
        chainId: 137,
      };
      this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl, network);

      // Setup reconnection handlers with detailed logging
      this.wsProvider.websocket.on("close", (code, reason) => {
        console.log(`⚠️ ${currentProvider.toUpperCase()} WebSocket CLOSED:`);
        console.log(`   - Code: ${code}`);
        console.log(`   - Reason: ${reason || "No reason given"}`);
        this.handleWSReconnect();
      });

      this.wsProvider.websocket.on("error", (error) => {
        console.error(`❌ ${currentProvider.toUpperCase()} WebSocket ERROR:`);
        console.error(`   - Message: ${error.message}`);
        this.handleWSReconnect();
      });

      this.wsProvider.websocket.on("open", () => {
        console.log(
          `✅ ${currentProvider.toUpperCase()} WebSocket OPENED successfully`
        );
      });

      // Test the connection with timeout
      console.log(`🧪 Testing ${currentProvider.toUpperCase()} connection...`);
      const connectionTest = Promise.race([
        this.wsProvider.getNetwork(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Connection timeout after 10 seconds")),
            10000
          )
        ),
      ]);

      const wsNetwork = await connectionTest;
      console.log(
        `✅ ${currentProvider.toUpperCase()} WebSocket connected successfully!`
      );
      console.log(`   - Chain ID: ${wsNetwork.chainId}`);
      this.wsReconnectAttempts = 0;
    } catch (error) {
      console.error(
        `❌ ${currentProvider.toUpperCase()} WebSocket connection FAILED:`
      );
      console.error(`   - Error: ${error.message}`);
      await this.rotateToNextWSProvider();
    }
  }

  async rotateToNextWSProvider() {
    const currentProvider =
      this.config.wsProviders[this.currentWsProviderIndex];
    console.log(`\n🔄 ROTATING from ${currentProvider.toUpperCase()}`);

    this.currentWsProviderIndex =
      (this.currentWsProviderIndex + 1) % this.config.wsProviders.length;
    const nextProvider = this.config.wsProviders[this.currentWsProviderIndex];

    console.log(
      `🔄 Next provider: ${nextProvider.toUpperCase()} (index: ${
        this.currentWsProviderIndex
      })`
    );

    // Reset attempts when we complete a full rotation
    if (this.currentWsProviderIndex === 0) {
      this.wsReconnectAttempts++;
      console.log(
        `🔄 Completed full rotation - attempt ${this.wsReconnectAttempts}/${this.config.wsMaxReconnectAttempts}`
      );
    }

    await this.setupWebSocketProvider();
  }

  async handleWSReconnect() {
    if (this.wsReconnectAttempts >= this.config.wsMaxReconnectAttempts) {
      console.log(
        "❌ Max WebSocket reconnect attempts reached, falling back to HTTP polling"
      );
      this.wsProvider = null;
      return;
    }

    const currentProvider =
      this.config.wsProviders[this.currentWsProviderIndex];
    console.log(
      `🔄 WebSocket reconnect attempt ${this.wsReconnectAttempts + 1}/${
        this.config.wsMaxReconnectAttempts
      } for ${currentProvider.toUpperCase()}`
    );

    setTimeout(async () => {
      await this.rotateToNextWSProvider();
    }, this.config.wsReconnectInterval);
  }

  // Get the best provider for monitoring (WebSocket preferred, HTTP fallback)
  getMonitoringProvider() {
    return this.wsProvider && this.wsProvider.websocket.readyState === 1
      ? this.wsProvider
      : this.provider;
  }

  // INFURA GAS API - REAL-TIME OPTIMAL GAS PRICING
  async getOptimalGasPrice(priority = "fast") {
    const now = Date.now();

    // Use cached data if still fresh
    if (
      this.gasCache.data &&
      now - this.gasCache.timestamp < this.gasCache.ttl
    ) {
      return this.calculateGasFromCache(priority);
    }

    try {
      const gasUrl = `${this.config.gasApiUrl}/${this.config.infuraGasApiKey}/networks/137/suggestedGasFees`;

      const response = await fetch(gasUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Gas API response: ${response.status}`);
      }

      const gasData = await response.json();

      // Cache the fresh data
      this.gasCache.data = gasData;
      this.gasCache.timestamp = now;

      if (this.config.debug) {
        console.log("🔥 Fresh gas prices from Infura:", {
          slow: gasData.low,
          standard: gasData.medium,
          fast: gasData.high,
          priority: gasData.estimatedBaseFee,
        });
      }

      return this.calculateGasFromCache(priority);
    } catch (error) {
      console.warn(
        "⚠️ Infura Gas API failed, falling back to RPC:",
        error.message
      );

      // Fallback to standard RPC gas price
      const fallbackGas = await this.provider.getGasPrice();
      const multiplier =
        priority === "emergency"
          ? this.config.emergencyGasMult
          : this.config.gasMult;
      return fallbackGas.mul(Math.floor(multiplier * 100)).div(100);
    }
  }

  calculateGasFromCache(priority) {
    if (!this.gasCache.data) return null;

    const gasData = this.gasCache.data;
    let baseGas;

    switch (priority) {
      case "emergency":
        baseGas = ethers.utils.parseUnits(
          gasData.high || gasData.medium || gasData.low,
          "gwei"
        );
        return baseGas
          .mul(Math.floor(this.config.emergencyGasMult * 100))
          .div(100);

      case "fast":
        baseGas = ethers.utils.parseUnits(
          gasData.high || gasData.medium,
          "gwei"
        );
        return baseGas.mul(Math.floor(this.config.gasMult * 100)).div(100);

      case "standard":
        baseGas = ethers.utils.parseUnits(
          gasData.medium || gasData.low,
          "gwei"
        );
        return baseGas;

      case "slow":
        baseGas = ethers.utils.parseUnits(gasData.low, "gwei");
        return baseGas;

      default:
        baseGas = ethers.utils.parseUnits(
          gasData.high || gasData.medium,
          "gwei"
        );
        return baseGas.mul(Math.floor(this.config.gasMult * 100)).div(100);
    }
  }

  // INTEGRATED SWEEP FUNCTIONS - Use optimized sweeper bot first
  async sweepUSDTOnly() {
    console.log("🎯 INTEGRATED DEFENSE: Sweeping USDT");

    if (this.sweeperReady) {
      try {
        console.log("🚀 Using BloxRoute-optimized sweeper for USDT...");
        const result = await this.sweeperBot.sweepToken(
          this.config.usdtContract
        );

        if (result.isDryRun) {
          console.log("🔍 DRY RUN: Would sweep USDT via BloxRoute");
          return result;
        }

        console.log(`🎯 USDT swept via BloxRoute: ${result.hash}`);
        return result;
      } catch (error) {
        console.error("❌ BloxRoute USDT sweep failed:", error.message);
        console.log("🔄 Falling back to direct sweep...");
        return await this.fallbackSweepUSDT();
      }
    } else {
      console.log("⚠️ Sweeper bot not ready, using direct method");
      return await this.fallbackSweepUSDT();
    }
  }

  async sweepMATICOnly() {
    console.log("🎯 INTEGRATED DEFENSE: Sweeping MATIC");

    if (this.sweeperReady) {
      try {
        console.log("🚀 Using BloxRoute-optimized sweeper for MATIC...");
        const result = await this.sweeperBot.sweepMatic();

        if (result.isDryRun) {
          console.log("🔍 DRY RUN: Would sweep MATIC via BloxRoute");
          return result;
        }

        console.log(`🎯 MATIC swept via BloxRoute: ${result.hash}`);
        return result;
      } catch (error) {
        console.error("❌ BloxRoute MATIC sweep failed:", error.message);
        console.log("🔄 Falling back to direct sweep...");
        return await this.fallbackSweepMATIC();
      }
    } else {
      console.log("⚠️ Sweeper bot not ready, using direct method");
      return await this.fallbackSweepMATIC();
    }
  }

  async sweepSpecificToken(tokenAddress) {
    console.log(`🎯 INTEGRATED DEFENSE: Sweeping token ${tokenAddress}`);

    if (this.sweeperReady) {
      try {
        console.log(
          `🚀 Using BloxRoute-optimized sweeper for token ${tokenAddress}...`
        );
        const result = await this.sweeperBot.sweepToken(tokenAddress);

        if (result.isDryRun) {
          console.log(
            `🔍 DRY RUN: Would sweep token ${tokenAddress} via BloxRoute`
          );
          return result;
        }

        console.log(
          `🎯 Token ${tokenAddress} swept via BloxRoute: ${result.hash}`
        );
        return result;
      } catch (error) {
        console.error(
          `❌ BloxRoute token sweep failed for ${tokenAddress}:`,
          error.message
        );
        console.log("🔄 Falling back to direct sweep...");
        return await this.fallbackSweepToken(tokenAddress);
      }
    } else {
      console.log("⚠️ Sweeper bot not ready, using direct method");
      return await this.fallbackSweepToken(tokenAddress);
    }
  }

  // FALLBACK SWEEP METHODS (using existing direct approach)
  async fallbackSweepUSDT() {
    console.log("🔄 FALLBACK: Direct USDT sweep via Alchemy");

    try {
      const txData = await this.sweeperContract.populateTransaction.sweepToken(
        this.config.usdtContract
      );
      const result = await this.sendEmergencyTx(
        {
          to: txData.to,
          data: txData.data,
        },
        true
      );

      if (result.isDryRun) {
        console.log("🔍 DRY RUN: Would sweep USDT via fallback");
        return result;
      }

      console.log(`🔄 Fallback USDT sweep submitted: ${result.hash}`);
      const receipt = await result.wait(1);
      console.log(
        `✅ Fallback USDT sweep confirmed in block ${receipt.blockNumber}`
      );
      return receipt;
    } catch (error) {
      console.error("❌ Fallback USDT sweep failed:", error.message);
      throw error;
    }
  }

  async fallbackSweepMATIC() {
    console.log("🔄 FALLBACK: Direct MATIC sweep via Alchemy");

    try {
      const txData =
        await this.sweeperContract.populateTransaction.sweepAllMaticNow();
      const result = await this.sendEmergencyTx(
        {
          to: txData.to,
          data: txData.data,
        },
        true
      );

      if (result.isDryRun) {
        console.log("🔍 DRY RUN: Would sweep MATIC via fallback");
        return result;
      }

      console.log(`🔄 Fallback MATIC sweep submitted: ${result.hash}`);
      const receipt = await result.wait(1);
      console.log(
        `✅ Fallback MATIC sweep confirmed in block ${receipt.blockNumber}`
      );
      return receipt;
    } catch (error) {
      console.error("❌ Fallback MATIC sweep failed:", error.message);
      throw error;
    }
  }

  async fallbackSweepToken(tokenAddress) {
    console.log(
      `🔄 FALLBACK: Direct token sweep for ${tokenAddress} via Alchemy`
    );

    try {
      const txData = await this.sweeperContract.populateTransaction.sweepToken(
        tokenAddress
      );
      const result = await this.sendEmergencyTx(
        {
          to: txData.to,
          data: txData.data,
        },
        true
      );

      if (result.isDryRun) {
        console.log(
          `🔍 DRY RUN: Would sweep token ${tokenAddress} via fallback`
        );
        return result;
      }

      console.log(`🔄 Fallback token sweep submitted: ${result.hash}`);
      const receipt = await result.wait(1);
      console.log(
        `✅ Fallback token sweep confirmed in block ${receipt.blockNumber}`
      );
      return receipt;
    } catch (error) {
      console.error(
        `❌ Fallback token sweep failed for ${tokenAddress}:`,
        error.message
      );
      throw error;
    }
  }

  // EMERGENCY-OPTIMIZED TRANSACTION EXECUTION (Fallback method)
  async sendEmergencyTx(txOverrides = {}, isEmergency = false) {
    // Always use Alchemy for fallback transactions
    const txProvider = this.alchemyTxProvider;
    const txSigner = new ethers.Wallet(this.config.privateKey, txProvider);

    try {
      let tx = { ...txOverrides };

      // Aggressive gas settings for maximum speed
      if (!tx.gasLimit) {
        const gasEstimate = await txProvider.estimateGas({
          to: tx.to,
          data: tx.data,
          from: txSigner.address,
          value: tx.value || 0,
        });
        tx.gasLimit = gasEstimate.mul(isEmergency ? 200 : 150).div(100);
      }

      if (!tx.gasPrice && !tx.maxFeePerGas) {
        // Use Infura Gas API for optimal pricing
        const priority = isEmergency ? "emergency" : "fast";
        const optimalGas = await this.getOptimalGasPrice(priority);

        if (optimalGas) {
          tx.gasPrice = optimalGas;
        } else {
          // Final fallback using Alchemy provider
          const fallbackGas = await txProvider.getGasPrice();
          const mult = isEmergency
            ? this.config.emergencyGasMult
            : this.config.gasMult;
          tx.gasPrice = fallbackGas.mul(Math.floor(mult * 100)).div(100);
        }
      }

      if (this.config.dryRun) {
        console.log(
          `[DRY RUN] ${
            isEmergency ? "EMERGENCY" : "Fast"
          } transaction via ALCHEMY:`,
          {
            to: tx.to,
            gasLimit: tx.gasLimit?.toString(),
            gasPrice: tx.gasPrice
              ? ethers.utils.formatUnits(tx.gasPrice, "gwei") + " gwei"
              : "N/A",
            priority: isEmergency ? "EMERGENCY" : "FAST",
          }
        );
        return { isDryRun: true };
      }

      const gasPriceGwei = tx.gasPrice
        ? ethers.utils.formatUnits(tx.gasPrice, "gwei")
        : "N/A";
      console.log(
        `🚀 ${
          isEmergency ? "EMERGENCY" : "Fast"
        } TX via ALCHEMY: ${gasPriceGwei} gwei | Limit: ${tx.gasLimit?.toString()}`
      );

      const txResponse = await txSigner.sendTransaction(tx);
      return txResponse;
    } catch (err) {
      console.error("❌ Emergency transaction failed:", err.message);
      throw err;
    }
  }

  // SMART THREAT DETECTION WITH SELECTIVE RESPONSE
  detectAssetFromTransaction(tx) {
    if (!tx || !tx.data) return null;

    const data = tx.data.toLowerCase();

    // Check for ERC20 transfer/transferFrom function selectors
    if (data.includes("a9059cbb") || data.includes("23b872dd")) {
      if (data.includes("23b872dd")) {
        // transferFrom - extract 'to' address (3rd parameter)
        const toAddress = "0x" + data.slice(4 + 64 + 24, 4 + 64 + 64);
        if (toAddress.toLowerCase() === this.config.safeAddress.toLowerCase()) {
          return {
            threat: true,
            asset: tx.to,
            type: "TOKEN_INCOMING",
            direction: "IN",
          };
        }
      }

      if (data.includes("a9059cbb")) {
        // transfer - extract 'to' address (1st parameter)
        const toAddress = "0x" + data.slice(4 + 24, 4 + 64);
        if (
          toAddress.toLowerCase() !== this.config.safeAddress.toLowerCase() &&
          tx.to === this.config.safeAddress
        ) {
          return {
            threat: true,
            asset: "UNKNOWN_TOKEN",
            type: "TOKEN_OUTGOING",
            direction: "OUT",
          };
        }
      }
    }

    // Check for MATIC transfers (value > 0 to/from Safe)
    if (tx.value && ethers.BigNumber.from(tx.value).gt(0)) {
      if (tx.to === this.config.safeAddress) {
        return {
          threat: false,
          asset: "MATIC",
          type: "MATIC_INCOMING",
          direction: "IN",
        };
      } else if (tx.from === this.config.safeAddress) {
        return {
          threat: true,
          asset: "MATIC",
          type: "MATIC_OUTGOING",
          direction: "OUT",
        };
      }
    }

    return null;
  }

  // INTEGRATED THREAT RESPONSE WITH TIMING METRICS
  async handleIntegratedThreat(assetAddress, threatType, txHash = null) {
    const startTime = Date.now();
    const asset =
      this.knownTokens.get(assetAddress.toLowerCase()) || assetAddress;

    console.log(
      `🚨 INTEGRATED THREAT DETECTED: ${asset} - ${threatType} ${
        txHash ? `(${txHash})` : ""
      }`
    );
    console.log(
      `⚡ Response method: ${
        this.sweeperReady ? "BloxRoute → Fallback" : "Direct Alchemy"
      }`
    );

    try {
      let result;

      // Route to integrated sweeper based on asset type
      if (
        assetAddress.toLowerCase() === this.config.usdtContract.toLowerCase()
      ) {
        console.log("🚨 USDT THREAT → Triggering integrated USDT sweep");
        result = await this.sweepUSDTOnly();
      } else if (
        assetAddress.toLowerCase() === this.MATIC_ADDRESS ||
        asset === "MATIC"
      ) {
        console.log("🚨 MATIC THREAT → Triggering integrated MATIC sweep");
        result = await this.sweepMATICOnly();
      } else {
        console.log(`🚨 TOKEN THREAT → Triggering integrated ${asset} sweep`);
        result = await this.sweepSpecificToken(assetAddress);
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `✅ Integrated defense completed for ${asset} in ${elapsed}ms`
      );

      // Log response efficiency
      if (elapsed < 2000) {
        console.log("🎉 EXCELLENT: Sub-2-second response time!");
      } else if (elapsed < 5000) {
        console.log("✅ GOOD: Sub-5-second response time");
      } else {
        console.log("⚠️ SLOW: Response took longer than expected");
      }

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(
        `❌ Integrated defense failed for ${asset} after ${elapsed}ms:`,
        error.message
      );
      throw error;
    }
  }

  // ENHANCED MONITORING WITH INTEGRATED RESPONSES
  async startIntegratedMonitoring() {
    if (this.isMonitoring) {
      console.log("⚠️ Already monitoring");
      return;
    }

    this.isMonitoring = true;
    console.log("🎯 Starting integrated threat monitoring...");

    // Monitor USDT transfers - HIGHEST PRIORITY
    this.usdtContract.on("Transfer", async (from, to, value, event) => {
      try {
        if (
          from === this.config.safeAddress ||
          to === this.config.safeAddress
        ) {
          console.log(
            `🔍 USDT Transfer: ${ethers.utils.formatUnits(value, 6)} USDT`
          );
          console.log(
            `   From: ${from} | To: ${to} | TX: ${event.transactionHash}`
          );

          // USDT leaving Safe → Immediate integrated USDT sweep
          if (
            from === this.config.safeAddress &&
            to !== this.config.vaultAddress
          ) {
            console.log("🚨 USDT THREAT: Unauthorized transfer from Safe!");
            await this.handleIntegratedThreat(
              this.config.usdtContract,
              "USDT_DRAIN",
              event.transactionHash
            );
          }
        }
      } catch (error) {
        console.error("Error handling USDT transfer:", error.message);
      }
    });

    // Monitor pending transactions for fast response
    const monitoringProvider = this.getMonitoringProvider();
    monitoringProvider.on("pending", async (txHash) => {
      try {
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;

        // Quick analysis for transactions involving our Safe
        if (
          tx.to === this.config.safeAddress ||
          tx.from === this.config.safeAddress
        ) {
          console.log(`🔍 Pending Safe transaction: ${txHash}`);

          const analysis = this.detectAssetFromTransaction(tx);
          if (analysis && analysis.threat) {
            console.log(
              `🎯 INTEGRATED THREAT in pending tx: ${analysis.asset} - ${analysis.type}`
            );

            // Immediate integrated response
            if (analysis.asset === this.config.usdtContract) {
              await this.handleIntegratedThreat(
                this.config.usdtContract,
                analysis.type,
                txHash
              );
            } else if (analysis.asset === "MATIC") {
              await this.handleIntegratedThreat(
                this.MATIC_ADDRESS,
                analysis.type,
                txHash
              );
            } else if (analysis.asset !== "UNKNOWN_TOKEN") {
              await this.handleIntegratedThreat(
                analysis.asset,
                analysis.type,
                txHash
              );
            }
          }
        }
      } catch (error) {
        // Expected for many pending transactions, ignore
      }
    });

    console.log("✅ Integrated monitoring active:");
    console.log(
      "   ⚡ Gas Strategy: Infura Gas API → Real-time optimal pricing"
    );
    console.log(
      "   🚀 WebSocket Monitoring: QuickNode → Alchemy → Infura (round-robin)"
    );
    console.log(
      `   💎 Transaction Execution: ${
        this.sweeperReady ? "BloxRoute → Alchemy fallback" : "Alchemy direct"
      }`
    );
    console.log("   🥇 Priority 1: USDT threats → Integrated USDT sweeps");
    console.log("   🥈 Priority 2: MATIC threats → Integrated MATIC sweeps");
    console.log(
      "   🥉 Priority 3: Other tokens → Integrated token-specific sweeps"
    );
  }

  async stopMonitoring() {
    this.isMonitoring = false;

    // Clean up all providers
    if (this.provider) {
      this.provider.removeAllListeners();
    }
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      if (this.wsProvider.websocket) {
        this.wsProvider.websocket.close();
      }
    }
    if (this.usdtContract) {
      this.usdtContract.removeAllListeners();
    }

    console.log("🛑 Integrated monitoring stopped");
  }

  // Add health check for integrated system
  async systemHealthCheck() {
    console.log("🔍 Integrated System Health Check:");

    // Monitor health
    const monitoringProvider = this.getMonitoringProvider();
    const isMonitoringActive = monitoringProvider && this.isMonitoring;
    console.log(
      `  - Monitoring: ${isMonitoringActive ? "✅ Active" : "❌ Inactive"}`
    );

    // Sweeper health
    console.log(
      `  - Sweeper Bot: ${this.sweeperReady ? "✅ Ready" : "❌ Not Ready"}`
    );

    if (this.sweeperReady) {
      const sweeperStatus = await this.sweeperBot.getStatus();
      console.log(
        `  - Sweeper Auth: ${
          sweeperStatus.isAuthorized ? "✅ Authorized" : "❌ Not Authorized"
        }`
      );
      console.log(
        `  - BloxRoute: ${
          this.sweeperBot.bloxrouteWs ? "✅ Connected" : "❌ Disconnected"
        }`
      );
    }

    // Gas pricing
    const gasStatus = this.gasCache.data ? "✅ Cached" : "⚠️ No Cache";
    console.log(`  - Gas API: ${gasStatus}`);

    return {
      monitoring: isMonitoringActive,
      sweeper: this.sweeperReady,
      bloxroute: this.sweeperBot?.bloxrouteWs?.readyState === 1,
      gas: !!this.gasCache.data,
    };
  }

  // Manual test functions
  async testIntegratedSweeps() {
    console.log("🧪 Testing integrated sweep functions...");

    console.log("1. Testing integrated USDT sweep...");
    await this.sweepUSDTOnly();

    console.log("2. Testing integrated MATIC sweep...");
    await this.sweepMATICOnly();

    console.log("✅ Integrated sweep tests completed");
  }

  async run() {
    try {
      console.log("🎯 Integrated Defensive Monitor Bot Starting...\n");

      await this.initialize();

      // Start integrated monitoring
      await this.startIntegratedMonitoring();

      console.log("\n🎯 Integrated Monitor Bot is now active!");
      console.log(
        "🛡️ Watching for threats with BloxRoute-optimized response..."
      );
      console.log("Press Ctrl+C to stop monitoring");

      // Keep the process running
      process.on("SIGINT", async () => {
        console.log("\n🛑 Shutting down integrated monitor...");
        await this.stopMonitoring();
        process.exit(0);
      });
    } catch (error) {
      console.error("\n💥 Integrated Monitor Bot failed:", error.message);
      process.exit(1);
    }
  }
}

// Execute the integrated monitor bot
async function main() {
  const monitor = new IntegratedDefensiveBot(CONFIG);

  // For testing specific functions:
  // await monitor.initialize();
  // await monitor.testIntegratedSweeps();

  // For production monitoring:
  await monitor.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { IntegratedDefensiveBot };
