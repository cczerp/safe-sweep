#!/usr/bin/env node

/**
 * EOA Wallet Bot - Deployment Script
 *
 * Quick start:
 * 1. Copy .env.example to .env
 * 2. Fill in EOA_WALLET_ADDRESS and EOA_PRIVATE_KEY
 * 3. Run: node run_eoa_bot.js
 */

require("dotenv").config();
const { ethers } = require("ethers");
const EOAWalletBot = require("./eoa_wallet_bot");

// Build configuration from .env
const config = {
  walletAddress: process.env.EOA_WALLET_ADDRESS,
  privateKey: process.env.EOA_PRIVATE_KEY,

  // Primary RPC (use Alchemy if available, else QuickNode, else Infura)
  rpcUrl: process.env.ALCHEMY_HTTP || process.env.QUICKNODE_HTTP || process.env.INFURA_HTTP,
  wsRpcUrl: process.env.ALCHEMY_WSS || process.env.QUICKNODE_WSS || process.env.INFURA_WSS,

  // Backup RPCs (all available providers)
  backupRpcUrls: [
    process.env.QUICKNODE_HTTP,
    process.env.INFURA_HTTP,
    process.env.ANKR_HTTP,
    process.env.NODIES_HTTP,
  ].filter(Boolean), // Remove undefined values

  // Chain settings
  chainId: parseInt(process.env.CHAIN_ID || "137"),

  // Gas settings (use EOA-specific or fall back to main settings)
  gasPremium: parseFloat(process.env.EOA_GAS_PREMIUM || process.env.GAS_PREMIUM || "0.5"),
  maxGasPrice: ethers.utils.parseUnits(
    process.env.EOA_MAX_GAS_PRICE_GWEI || process.env.MAX_GAS_PRICE_GWEI || "1000",
    "gwei"
  ),

  // Monitoring settings
  monitoringInterval: parseInt(process.env.EOA_MONITORING_INTERVAL || "500"),
  enableTxPoolMonitoring: process.env.EOA_ENABLE_TXPOOL !== "false",
  enableWebSocketMonitoring: process.env.EOA_ENABLE_WEBSOCKET !== "false",

  // MEV Bundle settings (use same searcher key as main system)
  enableMEVBundles: process.env.ENABLE_MEV_BUNDLES !== "false",
  searcherPrivateKey: process.env.MEV_SEARCHER_KEY,
  bundleTimeout: parseInt(process.env.BUNDLE_TIMEOUT || "30"),
  maxBlocksAhead: parseInt(process.env.MAX_BLOCKS_AHEAD || "3"),
  bundlePriorityFee: ethers.utils.parseUnits(
    process.env.BUNDLE_PRIORITY_FEE || "50",
    "gwei"
  ),
};

// Validate configuration
if (!config.walletAddress || config.walletAddress === "0xYourTrustWalletAddress") {
  console.error("❌ Please set EOA_WALLET_ADDRESS in .env file");
  process.exit(1);
}

if (!config.privateKey || config.privateKey === "your_trust_wallet_private_key_here") {
  console.error("❌ Please set EOA_PRIVATE_KEY in .env file");
  console.error("   ⚠️  WARNING: Keep your private key secure and never commit .env to git!");
  process.exit(1);
}

if (!config.rpcUrl) {
  console.error("❌ No RPC endpoint found in .env file");
  console.error("   Please set at least one of: ALCHEMY_HTTP, QUICKNODE_HTTP, or INFURA_HTTP");
  process.exit(1);
}

// Banner
console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║                                                            ║");
console.log("║              🤖 EOA WALLET BOT v1.0 🤖                     ║");
console.log("║                                                            ║");
console.log("║       High-Speed Approval Revocation System                ║");
console.log("║                                                            ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log();

// Create bot instance
const bot = new EOAWalletBot(config);

// Graceful shutdown handler
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, shutting down gracefully...");
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, shutting down gracefully...");
  await bot.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("\n❌ Uncaught Exception:", error);
  bot.stop().then(() => process.exit(1));
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Start the bot
(async () => {
  try {
    await bot.start();

    // Keep process alive
    process.stdin.resume();
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
})();
