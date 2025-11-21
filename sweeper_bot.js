const { ethers } = require("ethers");
const WebSocket = require("ws");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

// Configuration
const CONFIG = {
  sweeperAddress: process.env.SWEEPER_MODULE,
  rpcUrl: process.env.RPC_URL,
  bloxrouteHeader: process.env.BLOXROUTE_HEADER,
  privateKey: process.env.PRIVATE_KEY,
  vaultAddress: process.env.VAULT_ADDRESS,
  safeAddress: process.env.SAFE_ADDRESS,
  usdtContract: process.env.USDT_CONTRACT,
  chainId: parseInt(process.env.CHAIN_ID) || 137,
  dryRun: process.env.DRY_RUN === "true",
  debug: process.env.DEBUG === "true",
  gasMult: parseFloat(process.env.MEMPOOL_GAS_MULTIPLIER) || 2.0,
  noncePersistPath:
    process.env.NONCE_PERSIST_PATH ||
    path.join(
      process.cwd(),
      `.nonce_${(process.env.PRIVATE_KEY || "anon").slice(-8)}.json`
    ),
};

// DefensiveSweeper ABI
const SWEEPER_ABI = [
  "function sweepMaticAmount(uint256 amount) external",
  "function sweepMatic() external",
  "function sweepAllMaticNow() external",
  "function sweepTokenAmount(address tokenAddress, uint256 amount) external",
  "function sweepToken(address tokenAddress) external",
  "function isAuthorized(address user) external view returns (bool)",
  "function getSafeMaticBalance() external view returns (uint256)",
  "function getVaultMaticBalance() external view returns (uint256)",
  "function healthCheck() external view returns (bool, uint256, uint256, address, address, address)",
];

// Simple NonceManager
class NonceManager {
  constructor(provider, signerAddress, opts = {}) {
    this.provider = provider;
    this.address = signerAddress;
    this.persistPath =
      opts.persistPath ||
      path.join(process.cwd(), `.nonce_${this.address}.json`);
    this.nextNonce = null;
  }

  async init() {
    try {
      const chainCount = await this.provider.getTransactionCount(
        this.address,
        "pending"
      );
      this.nextNonce = BigInt(chainCount.toString());
      console.log(`[NonceManager] init -> nextNonce=${this.nextNonce}`);
    } catch (e) {
      console.warn("[NonceManager] init failed:", e.message);
      this.nextNonce = 0n;
    }
  }

  async reserveNonce() {
    if (this.nextNonce === null) await this.init();
    const n = this.nextNonce;
    this.nextNonce = n + 1n;
    return n;
  }

  async markDone(n) {
    // Simple implementation
  }
}

// Clean Sweeper Bot
class CleanSweeperBot {
  constructor(config) {
    this.config = config;
    console.log("🚀 Initializing Clean Sweeper Bot...");
    this.provider = null;
    this.bloxrouteWs = null;
    this.signer = null;
    this.sweeperContract = null;
    this.nonceManager = null;
  }

  async initialize() {
    console.log("🔧 Configuration:");
    console.log(`  - Safe: ${this.config.safeAddress}`);
    console.log(`  - Vault: ${this.config.vaultAddress}`);
    console.log(`  - Sweeper: ${this.config.sweeperAddress}`);
    console.log(`  - DRY RUN: ${this.config.dryRun}`);
    console.log(
      `  - BloxRoute Header: ${
        this.config.bloxrouteHeader ? "Present" : "Missing"
      }`
    );
    if (this.config.bloxrouteHeader) {
      console.log(
        `  - Header length: ${this.config.bloxrouteHeader.length} chars`
      );
    }

    if (!this.config.rpcUrl) throw new Error("RPC_URL missing");
    if (!this.config.privateKey) throw new Error("PRIVATE_KEY missing");

    console.log("\n📡 Connecting to RPC...");
    this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl);

    const network = await this.provider.getNetwork();
    console.log(`✅ Connected - Chain ID: ${network.chainId}`);

    if (this.config.bloxrouteHeader) {
      console.log("🔗 Setting up BloxRoute...");
      await this.setupBloxRoute();
    } else {
      console.log("⚠️ No BloxRoute header - using standard RPC only");
    }

    console.log("🔑 Setting up wallet...");
    this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
    console.log(`✅ Wallet: ${this.signer.address}`);

    this.nonceManager = new NonceManager(this.provider, this.signer.address, {
      persistPath: this.config.noncePersistPath,
    });
    await this.nonceManager.init();

    this.sweeperContract = new ethers.Contract(
      this.config.sweeperAddress,
      SWEEPER_ABI,
      this.signer
    );

    return true;
  }

  async setupBloxRoute() {
    return new Promise((resolve) => {
      try {
        console.log(
          `[BLXR DEBUG] Connecting with auth: ${
            this.config.bloxrouteHeader ? "Present" : "Missing"
          }`
        );

        this.bloxrouteWs = new WebSocket("wss://api.blxrbdn.com/ws", {
          headers: {
            Authorization: this.config.bloxrouteHeader,
          },
          rejectUnauthorized: false,
        });

        this.bloxrouteWs.on("open", () => {
          console.log("✅ BloxRoute WebSocket connected and ready");
          resolve();
        });

        this.bloxrouteWs.on("error", (error) => {
          console.log("[BLXR DEBUG] WebSocket error:", error.message);
          this.bloxrouteWs = null;
          resolve();
        });

        this.bloxrouteWs.on("close", (code, reason) => {
          console.log(`[BLXR DEBUG] WebSocket closed: ${code} ${reason}`);
          this.bloxrouteWs = null;
        });

        setTimeout(() => {
          if (
            this.bloxrouteWs &&
            this.bloxrouteWs.readyState !== WebSocket.OPEN
          ) {
            console.log("[BLXR DEBUG] Connection timeout");
            this.bloxrouteWs = null;
            resolve();
          }
        }, 5000);
      } catch (error) {
        console.log("[BLXR DEBUG] Setup failed:", error.message);
        this.bloxrouteWs = null;
        resolve();
      }
    });
  }

  async sendViaBloxRoute(signedTx) {
    return new Promise((resolve, reject) => {
      if (!this.bloxrouteWs || this.bloxrouteWs.readyState !== WebSocket.OPEN) {
        reject(new Error("BloxRoute WebSocket not connected"));
        return;
      }

      const txHex = signedTx.startsWith("0x") ? signedTx.slice(2) : signedTx;

      const request = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "blxr_private_tx",
        params: {
          transaction: txHex,
          timeout: 30,
          mev_builders: { all: "" },
          node_validation: true, // Add validation to see detailed error
        },
      };

      const requestId = request.id;

      const responseHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === requestId) {
            this.bloxrouteWs.removeListener("message", responseHandler);
            if (response.error) {
              console.log(
                "[BLXR DEBUG] Full error response:",
                JSON.stringify(response.error, null, 2)
              );
              reject(new Error(`BloxRoute error: ${response.error.message}`));
            } else {
              console.log(
                "[BLXR DEBUG] Success response:",
                JSON.stringify(response.result, null, 2)
              );
              resolve(response.result);
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      };

      this.bloxrouteWs.on("message", responseHandler);

      console.log(
        "[BLXR DEBUG] Sending request with validation:",
        JSON.stringify(request, null, 2)
      );
      this.bloxrouteWs.send(JSON.stringify(request));

      setTimeout(() => {
        this.bloxrouteWs.removeListener("message", responseHandler);
        reject(new Error("BloxRoute request timeout"));
      }, 10000);
    });
  }

  async getStatus() {
    console.log("\n📊 Status Check:");

    const isAuthorized = await this.sweeperContract.isAuthorized(
      this.signer.address
    );
    console.log(`Authorization: ${isAuthorized ? "✅ Yes" : "❌ No"}`);

    const [isOwnerAuth, safeBalance, vaultBalance, owner, safe, vault] =
      await this.sweeperContract.healthCheck();

    console.log(`Safe MATIC: ${ethers.utils.formatEther(safeBalance)}`);
    console.log(`Vault MATIC: ${ethers.utils.formatEther(vaultBalance)}`);

    return { isAuthorized, safeBalance, vaultBalance };
  }

  // Replace the sendTransaction method in your CleanSweeperBot class
  // Replace the sendTransaction method in your CleanSweeperBot class
  async sendTransaction(txData) {
    const rawNonce = await this.nonceManager.reserveNonce();
    const nonce = ethers.BigNumber.from(rawNonce.toString());

    let tx = {
      to: txData.to,
      data: txData.data,
      nonce: nonce,
      chainId: this.config.chainId,
    };

    const gasEstimate = await this.provider.estimateGas({
      to: tx.to,
      data: tx.data,
      from: this.signer.address,
    });
    tx.gasLimit = gasEstimate.mul(120).div(100);

    // Use EIP-1559 for BloxRoute compatibility
    const feeData = await this.provider.getFeeData();

    // For BloxRoute attempts, use emergency gas multiplier
    const gasMultiplier = this.bloxrouteWs
      ? parseFloat(process.env.EMERGENCY_GAS_MULTIPLIER) || 3.5
      : this.config.gasMult;

    tx.maxFeePerGas = feeData.maxFeePerGas
      .mul(Math.floor(gasMultiplier * 100))
      .div(100);
    tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      .mul(Math.floor(gasMultiplier * 100))
      .div(100);
    tx.type = 2; // EIP-1559 transaction

    console.log(`\n🚀 Sending transaction:`);
    console.log(`  To: ${tx.to}`);
    console.log(`  Nonce: ${tx.nonce.toString()}`);
    console.log(`  Gas: ${tx.gasLimit.toString()}`);
    console.log(
      `  Max Fee: ${ethers.utils.formatUnits(tx.maxFeePerGas, "gwei")} gwei`
    );
    console.log(
      `  Priority Fee: ${ethers.utils.formatUnits(
        tx.maxPriorityFeePerGas,
        "gwei"
      )} gwei`
    );
    console.log(`  Gas Multiplier: ${gasMultiplier}x`);

    if (this.config.dryRun) {
      console.log("🔍 DRY RUN - not sending");
      return { isDryRun: true };
    }

    let txResponse;

    // Try BloxRoute relay first with EIP-1559
    if (this.bloxrouteWs) {
      try {
        console.log("📡 Trying BloxRoute relay with EIP-1559...");
        const signedTx = await this.signer.signTransaction(tx);
        const bloxResult = await this.sendViaBloxRoute(signedTx);
        console.log(`✅ BloxRoute relay success:`, bloxResult);

        const txHash = ethers.utils.keccak256(signedTx);
        txResponse = { hash: txHash, nonce: tx.nonce };
      } catch (relayError) {
        console.log(`⚠️ BloxRoute relay failed: ${relayError.message}`);
        console.log("📤 Falling back to standard RPC...");

        // For fallback, use normal gas multiplier
        tx.maxFeePerGas = feeData.maxFeePerGas
          .mul(Math.floor(this.config.gasMult * 100))
          .div(100);
        tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
          .mul(Math.floor(this.config.gasMult * 100))
          .div(100);

        txResponse = await this.signer.sendTransaction(tx);
        console.log(`✅ Standard RPC success: ${txResponse.hash}`);
      }
    } else {
      console.log("📤 Using standard RPC...");
      // Use normal gas for standard RPC
      tx.maxFeePerGas = feeData.maxFeePerGas
        .mul(Math.floor(this.config.gasMult * 100))
        .div(100);
      tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
        .mul(Math.floor(this.config.gasMult * 100))
        .div(100);

      txResponse = await this.signer.sendTransaction(tx);
      console.log(`✅ Transaction sent: ${txResponse.hash}`);
    }

    console.log(`\nTransaction hash: ${txResponse.hash}`);
    console.log(`PolygonScan: https://polygonscan.com/tx/${txResponse.hash}`);

    // Simple confirmation check
    console.log("⏳ Checking confirmation...");
    let receipt = null;
    let attempts = 0;

    while (!receipt && attempts < 15) {
      try {
        receipt = await this.provider.getTransactionReceipt(txResponse.hash);
        if (receipt) {
          console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
          console.log(`Status: ${receipt.status === 1 ? "Success" : "Failed"}`);
          console.log(`Gas used: ${receipt.gasUsed.toString()}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
      } catch (e) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!receipt) {
      console.log(
        "⏰ Confirmation timeout - check Safe app for token movement"
      );
      return { hash: txResponse.hash, status: "timeout" };
    }

    return receipt;
  }

  async sweepMaticAmount(amount) {
    console.log(`[DEBUG] sweepMaticAmount called with amount: ${amount}`);
    const amountWei = ethers.utils.parseEther(amount.toString());
    console.log(`[DEBUG] Converted to wei: ${amountWei.toString()}`);
    console.log(`[DEBUG] That's ${ethers.utils.formatEther(amountWei)} MATIC`);

    const txData =
      await this.sweeperContract.populateTransaction.sweepMaticAmount(
        amountWei
      );
    console.log(`[DEBUG] Transaction data: ${txData.data}`);

    return await this.sendTransaction(txData);
  }

  async sweepMatic() {
    const txData = await this.sweeperContract.populateTransaction.sweepMatic();
    return await this.sendTransaction(txData);
  }

  async sweepTokenAmount(tokenAddress, amount, decimals = 6) {
    console.log(
      `[DEBUG] sweepTokenAmount called with token: ${tokenAddress}, amount: ${amount}, decimals: ${decimals}`
    );
    const amountWei = ethers.utils.parseUnits(amount.toString(), decimals);
    console.log(`[DEBUG] Converted to wei: ${amountWei.toString()}`);
    console.log(
      `[DEBUG] That's ${ethers.utils.formatUnits(amountWei, decimals)} tokens`
    );

    const txData =
      await this.sweeperContract.populateTransaction.sweepTokenAmount(
        tokenAddress,
        amountWei
      );
    console.log(`[DEBUG] Transaction data: ${txData.data}`);

    return await this.sendTransaction(txData);
  }

  async sweepToken(tokenAddress) {
    const txData = await this.sweeperContract.populateTransaction.sweepToken(
      tokenAddress
    );
    return await this.sendTransaction(txData);
  }

  async run(
    method = "sweepMatic",
    amount = null,
    tokenAddress = null,
    decimals = 6
  ) {
    try {
      console.log("🤖 Clean Sweeper Bot Starting...\n");

      await this.initialize();
      const statusBefore = await this.getStatus();

      if (!statusBefore.isAuthorized) {
        console.log("\n❌ Bot not authorized");
        return;
      }

      if (statusBefore.safeBalance.isZero() && method.includes("Matic")) {
        console.log("\n❌ No MATIC in Safe");
        return;
      }

      console.log(
        `\n🧹 Executing ${method}${
          amount
            ? ` (${amount}${method.includes("Token") ? " tokens" : " MATIC"})`
            : ""
        }...`
      );

      let result;
      switch (method) {
        case "sweepMaticAmount":
          if (!amount) throw new Error("Amount required");
          result = await this.sweepMaticAmount(amount);
          break;
        case "sweepMatic":
          result = await this.sweepMatic();
          break;
        case "sweepTokenAmount":
          if (!amount || !tokenAddress)
            throw new Error("Amount and tokenAddress required");
          result = await this.sweepTokenAmount(tokenAddress, amount, decimals);
          break;
        case "sweepToken":
          if (!tokenAddress) throw new Error("tokenAddress required");
          result = await this.sweepToken(tokenAddress);
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      if (result.isDryRun) {
        console.log("\n🧪 DRY RUN complete");
        return;
      }

      if (result.status === "timeout") {
        console.log("\n⏰ Transaction submitted but confirmation timed out");
        console.log("Check your Safe app to see if tokens moved");
        return;
      }

      // Check final balances for MATIC operations
      if (method.includes("Matic")) {
        const statusAfter = await this.getStatus();
        const sweptAmount = statusAfter.vaultBalance.sub(
          statusBefore.vaultBalance
        );

        console.log(`\n📊 Results:`);
        console.log(`Swept: ${ethers.utils.formatEther(sweptAmount)} MATIC`);
        console.log(
          `Vault: ${ethers.utils.formatEther(
            statusBefore.vaultBalance
          )} → ${ethers.utils.formatEther(statusAfter.vaultBalance)}`
        );

        if (sweptAmount.gt(0)) {
          console.log("🎉 SUCCESS! Tokens moved.");
        } else {
          console.log("⚠️ No tokens moved - check transaction on PolygonScan");
        }
      } else {
        console.log(
          "\n📊 Token sweep completed - check Safe app for token movement"
        );
        console.log("🎉 Transaction confirmed successfully");
      }
    } catch (error) {
      console.error("\n💥 Error:", error.message);
      process.exit(1);
    }
  }
}

// Execute
async function main() {
  const bot = new CleanSweeperBot(CONFIG);

  // Options for different sweep operations:

  // Sweep 1 USDT (exact amount)
  // const USDT_ADDRESS = CONFIG.usdtContract || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
  // await bot.run("sweepTokenAmount", 1, USDT_ADDRESS, 6);

  // Sweep ALL USDT (emergency sweep)
  const USDT_ADDRESS =
    CONFIG.usdtContract || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
  await bot.run("sweepToken", null, USDT_ADDRESS, 6);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { CleanSweeperBot };
