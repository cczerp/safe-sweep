#!/usr/bin/env node

/**
 * Convert Trust Wallet seed phrase to private key
 *
 * Usage: node get_private_key.js
 *
 * Then paste your seed phrase when prompted.
 */

const { ethers } = require("ethers");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║                                                            ║");
console.log("║         Trust Wallet → Private Key Converter              ║");
console.log("║                                                            ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log();
console.log("⚠️  SECURITY WARNING:");
console.log("   - Do this on YOUR computer only (not public/shared)");
console.log("   - Your seed phrase gives FULL ACCESS to your wallet");
console.log("   - Never share your seed phrase or private key");
console.log();

rl.question("Enter your Trust Wallet seed phrase (12 or 24 words): ", (seedPhrase) => {
  try {
    // Trim and normalize the seed phrase
    const normalizedSeed = seedPhrase.trim().toLowerCase();

    console.log("\n🔄 Converting seed phrase to private key...\n");

    // Derive the first address (default)
    const wallet = ethers.Wallet.fromMnemonic(normalizedSeed);

    console.log("✅ Success! Here are your wallet details:\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Address:     ${wallet.address}`);
    console.log(`Private Key: ${wallet.privateKey}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    console.log("\n📝 Add these to your .env file:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`EOA_WALLET_ADDRESS=${wallet.address}`);
    console.log(`EOA_PRIVATE_KEY=${wallet.privateKey}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    console.log("\n✅ Next steps:");
    console.log("   1. Copy the lines above into your .env file");
    console.log("   2. Run: node run_eoa_bot.js");
    console.log();
    console.log("⚠️  Clear your terminal history for security:");
    console.log("   Windows: cls");
    console.log("   Linux/Mac: clear");
    console.log();

    // Generate additional addresses if needed
    console.log("\n💡 If the address above doesn't match your Trust Wallet:");
    console.log("   Your wallet might use a different derivation path.");
    console.log("   Checking addresses 0-4...\n");

    for (let i = 0; i <= 4; i++) {
      const hdNode = ethers.utils.HDNode.fromMnemonic(normalizedSeed);
      const derivedWallet = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
      console.log(`   Address ${i}: ${derivedWallet.address}`);
      if (i === 0) console.log(`              (This is the default - shown above)`);
    }

    console.log();
    console.log("   If you see your Trust Wallet address in the list above,");
    console.log("   run this script again and I'll show you that specific private key.");
    console.log();

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.log("\nPossible issues:");
    console.log("   - Check your seed phrase is correct (12 or 24 words)");
    console.log("   - Make sure words are separated by spaces");
    console.log("   - Verify spelling of each word");
    console.log("   - Seed phrases are case-insensitive (lowercase is fine)");
    console.log();
  }

  rl.close();
});
