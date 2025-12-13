const { ethers } = require('ethers');
require('dotenv').config();

const SAFETY_TIMER_ABI = [
    "function healthCheck() external view returns (bool isInitialized, bool isEmergencyMode, uint256 pendingCount, uint256 timelockDelaySeconds, address safeAddr, address vaultAddr, uint256 protectedTokenCount)",
    "function getPendingTransactions() external view returns (bytes32[] memory)",
    "function pendingTxs(bytes32) external view returns (address to, uint256 value, bytes data, uint8 operation, address initiator, uint256 queuedAt, uint256 executableAt, bool executed, bool rejected, string reason)",
    "function approvePendingTransaction(bytes32 txHash) external",
    "function rejectPendingTransaction(bytes32 txHash, string calldata reason) external",
    "function executePendingTransaction(bytes32 txHash) external",
    "function getBlacklistedStatus(address addr) external view returns (bool isBlacklisted, uint256 attempts)",
    "function getProtectedTokens() external view returns (address[] memory)",
    "event MaliciousAttemptDetected(address indexed attacker, address indexed token, uint256 amount)",
    "event TokensSwept(address indexed token, uint256 amount, address indexed vault, string reason)",
    "event TransactionQueued(bytes32 indexed txHash, address indexed initiator, address to, uint256 value, string reason)",
    "event TransactionApproved(bytes32 indexed txHash, address indexed approver)",
    "event TransactionRejected(bytes32 indexed txHash, address indexed rejector, string reason)",
    "event TransactionExecuted(bytes32 indexed txHash, bool success)",
    "event AddressBlacklisted(address indexed addr, string reason)",
    "event EmergencyModeToggled(bool enabled)"
];

const IERC20_ABI = [
    "function balanceOf(address) external view returns (uint256)",
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)"
];

async function getTokenInfo(tokenAddress, provider) {
    try {
        const token = new ethers.Contract(tokenAddress, IERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([
            token.symbol(),
            token.decimals()
        ]);
        return { symbol, decimals };
    } catch (err) {
        return { symbol: 'UNKNOWN', decimals: 18 };
    }
}

async function formatTokenAmount(amount, decimals) {
    return ethers.utils.formatUnits(amount, decimals);
}

async function monitorSafetyTimer() {
    console.log("🔒 SafetyTimerModule Monitor\n");
    console.log("=".repeat(60));

    // Setup provider
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const safetyTimer = new ethers.Contract(
        process.env.SAFETY_TIMER_ADDRESS,
        SAFETY_TIMER_ABI,
        wallet
    );

    console.log("\n📋 Configuration:");
    console.log(`SafetyTimer: ${process.env.SAFETY_TIMER_ADDRESS}`);
    console.log(`Safe: ${process.env.SAFE_ADDRESS}`);
    console.log(`Vault: ${process.env.VAULT_ADDRESS}`);
    console.log(`Monitor: ${wallet.address}`);

    // Initial health check
    console.log("\n🏥 Initial Health Check:");
    const health = await safetyTimer.healthCheck();

    console.log(`Initialized: ${health.isInitialized ? '✅' : '❌'}`);
    console.log(`Emergency Mode: ${health.isEmergencyMode ? '🚨 ACTIVE' : '✅ Normal'}`);
    console.log(`Timelock Delay: ${health.timelockDelaySeconds / 3600} hours`);
    console.log(`Protected Tokens: ${health.protectedTokenCount}`);
    console.log(`Pending Transactions: ${health.pendingCount}`);

    if (!health.isInitialized) {
        console.error("\n❌ SafetyTimer not initialized!");
        console.error("Run: node setup_safety_timer.js");
        process.exit(1);
    }

    // Get protected tokens
    const protectedTokens = await safetyTimer.getProtectedTokens();
    if (protectedTokens.length > 0) {
        console.log("\n🛡️  Protected Tokens:");
        for (const token of protectedTokens) {
            const info = await getTokenInfo(token, provider);
            console.log(`  - ${info.symbol}: ${token}`);
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("👁️  Monitoring started - Watching for events...");
    console.log("=".repeat(60));
    console.log("");

    // Track stats
    let stats = {
        maliciousAttempts: 0,
        tokensSwept: 0,
        transactionsQueued: 0,
        transactionsApproved: 0,
        transactionsRejected: 0,
        addressesBlacklisted: 0
    };

    // Listen for Malicious Attempts
    safetyTimer.on('MaliciousAttemptDetected', async (attacker, token, amount, event) => {
        stats.maliciousAttempts++;

        const tokenInfo = await getTokenInfo(token, provider);
        const formattedAmount = await formatTokenAmount(amount, tokenInfo.decimals);

        console.log(`\n🚨 MALICIOUS ATTEMPT DETECTED!`);
        console.log(`├─ Attacker: ${attacker}`);
        console.log(`├─ Token: ${tokenInfo.symbol} (${token})`);
        console.log(`├─ Amount: ${formattedAmount}`);
        console.log(`├─ Block: ${event.blockNumber}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);

        // Check blacklist status
        const [isBlacklisted, attempts] = await safetyTimer.getBlacklistedStatus(attacker);
        console.log(`   Blacklisted: ${isBlacklisted ? 'YES' : 'NO'} (${attempts} attempts)`);

        // Alert (you can integrate Telegram/Discord/Email here)
        await sendAlert(`🚨 Malicious attempt from ${attacker} on ${tokenInfo.symbol}`);
    });

    // Listen for Token Sweeps
    safetyTimer.on('TokensSwept', async (token, amount, vault, reason, event) => {
        stats.tokensSwept++;

        const tokenInfo = token === ethers.constants.AddressZero
            ? { symbol: 'MATIC', decimals: 18 }
            : await getTokenInfo(token, provider);

        const formattedAmount = await formatTokenAmount(amount, tokenInfo.decimals);

        console.log(`\n✅ TOKENS SWEPT TO VAULT`);
        console.log(`├─ Token: ${tokenInfo.symbol}`);
        console.log(`├─ Amount: ${formattedAmount}`);
        console.log(`├─ Vault: ${vault}`);
        console.log(`├─ Reason: ${reason}`);
        console.log(`├─ Block: ${event.blockNumber}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);
    });

    // Listen for Queued Transactions
    safetyTimer.on('TransactionQueued', async (txHash, initiator, to, value, reason, event) => {
        stats.transactionsQueued++;

        console.log(`\n⏰ TRANSACTION QUEUED`);
        console.log(`├─ Hash: ${txHash}`);
        console.log(`├─ Initiator: ${initiator}`);
        console.log(`├─ To: ${to}`);
        console.log(`├─ Value: ${ethers.utils.formatEther(value)} MATIC`);
        console.log(`├─ Reason: ${reason}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);

        console.log(`\n   📋 Action Required:`);
        console.log(`   Approve: safetyTimer.approvePendingTransaction("${txHash}")`);
        console.log(`   Reject:  safetyTimer.rejectPendingTransaction("${txHash}", "reason")`);

        // Alert for review
        await sendAlert(`⏰ New transaction queued from ${initiator} - Review required`);
    });

    // Listen for Approvals
    safetyTimer.on('TransactionApproved', (txHash, approver, event) => {
        stats.transactionsApproved++;

        console.log(`\n✅ TRANSACTION APPROVED`);
        console.log(`├─ Hash: ${txHash}`);
        console.log(`├─ Approver: ${approver}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);
    });

    // Listen for Rejections
    safetyTimer.on('TransactionRejected', (txHash, rejector, reason, event) => {
        stats.transactionsRejected++;

        console.log(`\n❌ TRANSACTION REJECTED`);
        console.log(`├─ Hash: ${txHash}`);
        console.log(`├─ Rejector: ${rejector}`);
        console.log(`├─ Reason: ${reason}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);
    });

    // Listen for Executions
    safetyTimer.on('TransactionExecuted', (txHash, success, event) => {
        console.log(`\n🎯 TRANSACTION EXECUTED`);
        console.log(`├─ Hash: ${txHash}`);
        console.log(`├─ Success: ${success ? '✅' : '❌'}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);
    });

    // Listen for Blacklisting
    safetyTimer.on('AddressBlacklisted', (addr, reason, event) => {
        stats.addressesBlacklisted++;

        console.log(`\n🚫 ADDRESS BLACKLISTED`);
        console.log(`├─ Address: ${addr}`);
        console.log(`├─ Reason: ${reason}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);

        // High priority alert
        sendAlert(`🚫 Address blacklisted: ${addr} - ${reason}`);
    });

    // Listen for Emergency Mode
    safetyTimer.on('EmergencyModeToggled', (enabled, event) => {
        console.log(`\n${enabled ? '🚨' : '✅'} EMERGENCY MODE ${enabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`└─ Time: ${new Date().toLocaleString()}`);

        if (enabled) {
            sendAlert('🚨 EMERGENCY MODE ACTIVATED - All transactions blocked!');
        } else {
            sendAlert('✅ Emergency mode deactivated - Normal operations resumed');
        }
    });

    // Periodic Health Checks (every 5 minutes)
    setInterval(async () => {
        try {
            const health = await safetyTimer.healthCheck();

            console.log(`\n📊 Health Check [${new Date().toLocaleString()}]`);
            console.log(`├─ Emergency Mode: ${health.isEmergencyMode ? '🚨 ACTIVE' : '✅ Normal'}`);
            console.log(`├─ Pending Transactions: ${health.pendingCount}`);
            console.log(`└─ Protected Tokens: ${health.protectedTokenCount}`);

            // Show stats
            console.log(`\n📈 Statistics:`);
            console.log(`├─ Malicious Attempts: ${stats.maliciousAttempts}`);
            console.log(`├─ Tokens Swept: ${stats.tokensSwept}`);
            console.log(`├─ Transactions Queued: ${stats.transactionsQueued}`);
            console.log(`├─ Transactions Approved: ${stats.transactionsApproved}`);
            console.log(`├─ Transactions Rejected: ${stats.transactionsRejected}`);
            console.log(`└─ Addresses Blacklisted: ${stats.addressesBlacklisted}`);

        } catch (err) {
            console.error(`\n❌ Health check failed: ${err.message}`);
        }
    }, 5 * 60 * 1000);

    // Check for pending transactions that are ready to execute
    setInterval(async () => {
        try {
            const pendingHashes = await safetyTimer.getPendingTransactions();

            for (const hash of pendingHashes) {
                const tx = await safetyTimer.pendingTxs(hash);

                const now = Math.floor(Date.now() / 1000);
                const executableAt = tx.executableAt.toNumber();

                if (now >= executableAt && !tx.executed && !tx.rejected) {
                    console.log(`\n⏰ Transaction ready for execution: ${hash}`);
                    console.log(`   Run: executePendingTransaction("${hash}")`);

                    // Auto-execute if configured
                    if (process.env.AUTO_EXECUTE_PENDING === 'true') {
                        console.log(`   Auto-executing...`);
                        try {
                            const executeTx = await safetyTimer.executePendingTransaction(hash);
                            await executeTx.wait();
                            console.log(`   ✅ Auto-executed`);
                        } catch (err) {
                            console.error(`   ❌ Auto-execution failed: ${err.message}`);
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore errors
        }
    }, 60 * 1000); // Check every minute

    // Keep alive
    console.log("\n💚 Monitor is running...");
    console.log("Press Ctrl+C to stop\n");

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log("\n\n👋 Shutting down monitor...");
        console.log("\n📊 Final Statistics:");
        console.log(`Malicious Attempts Detected: ${stats.maliciousAttempts}`);
        console.log(`Tokens Swept: ${stats.tokensSwept}`);
        console.log(`Transactions Queued: ${stats.transactionsQueued}`);
        console.log(`Transactions Approved: ${stats.transactionsApproved}`);
        console.log(`Transactions Rejected: ${stats.transactionsRejected}`);
        console.log(`Addresses Blacklisted: ${stats.addressesBlacklisted}`);
        console.log("\n✅ Monitor stopped");
        process.exit(0);
    });
}

// Alert function (customize with your notification system)
async function sendAlert(message) {
    // TODO: Integrate with Telegram, Discord, Email, etc.
    // For now, just log
    console.log(`\n🔔 ALERT: ${message}`);

    // Example Telegram integration:
    // if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    //     const axios = require('axios');
    //     await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    //         chat_id: process.env.TELEGRAM_CHAT_ID,
    //         text: message
    //     });
    // }
}

// Run monitor
monitorSafetyTimer()
    .catch(error => {
        console.error("\n❌ Monitor failed:");
        console.error(error);
        process.exit(1);
    });
