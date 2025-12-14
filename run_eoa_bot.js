#!/usr/bin/env node

/**
 * EOA Wallet Bot - Deployment Script
 *
 * Quick start:
 * 1. Copy eoa_bot_config.example.json to eoa_bot_config.json
 * 2. Fill in your wallet address, private key, and RPC URLs
 * 3. Run: node run_eoa_bot.js
 */

const fs = require("fs");
const path = require("path");
const EOAWalletBot = require("./eoa_wallet_bot");

// Load configuration
const configPath = path.join(__dirname, "eoa_bot_config.json");

if (!fs.existsSync(configPath)) {
  console.error("❌ Configuration file not found!");
  console.error("   Please copy eoa_bot_config.example.json to eoa_bot_config.json");
  console.error("   and fill in your wallet details and RPC URLs.");
  process.exit(1);
}

let config;
try {
  const configData = fs.readFileSync(configPath, "utf8");
  config = JSON.parse(configData);
} catch (error) {
  console.error("❌ Failed to load configuration:", error.message);
  process.exit(1);
}

// Validate configuration
if (!config.walletAddress || config.walletAddress === "0xYOUR_TRUST_WALLET_ADDRESS_HERE") {
  console.error("❌ Please set your wallet address in eoa_bot_config.json");
  process.exit(1);
}

if (!config.privateKey || config.privateKey === "YOUR_PRIVATE_KEY_HERE") {
  console.error("❌ Please set your private key in eoa_bot_config.json");
  console.error("   ⚠️  WARNING: Keep your private key secure and never commit it to git!");
  process.exit(1);
}

if (!config.rpcUrl || config.rpcUrl === "https://polygon-rpc.com") {
  console.error("⚠️  WARNING: Using default RPC URL. Consider using a premium provider.");
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
