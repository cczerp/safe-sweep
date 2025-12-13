const { ethers } = require('ethers');
require('dotenv').config();

const SAFETY_TIMER_ABI = [
    "function addController(address controller) external",
    "function removeController(address controller) external",
    "function isController(address addr) external view returns (bool)",
    "function addProtectedToken(address token) external",
    "function removeProtectedToken(address token) external",
    "function getProtectedTokens() external view returns (address[] memory)",
    "function setTimelockDelay(uint256 newDelay) external",
    "function healthCheck() external view returns (bool isInitialized, bool isEmergencyMode, uint256 pendingCount, uint256 timelockDelaySeconds, address safeAddr, address vaultAddr, uint256 protectedTokenCount)",
    "event ControllerAdded(address indexed controller)",
    "event ProtectedTokenAdded(address indexed token)"
];

// Common Polygon tokens
const COMMON_TOKENS = {
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    WBTC: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'
};

async function configureSafetyTimer() {
    console.log("⚙️  SafetyTimerModule Configuration Script\n");
    console.log("=".repeat(50));

    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const safetyTimer = new ethers.Contract(
        process.env.SAFETY_TIMER_ADDRESS,
        SAFETY_TIMER_ABI,
        wallet
    );

    console.log("\n📋 Current Configuration:");

    const health = await safetyTimer.healthCheck();
    console.log(`Initialized: ${health.isInitialized}`);
    console.log(`Emergency Mode: ${health.isEmergencyMode}`);
    console.log(`Timelock Delay: ${health.timelockDelaySeconds / 3600} hours`);
    console.log(`Protected Tokens: ${health.protectedTokenCount}`);
    console.log(`Safe: ${health.safeAddr}`);
    console.log(`Vault: ${health.vaultAddr}`);

    // 1. Configure Controllers
    console.log("\n1️⃣  Configuring Controllers...");

    const controllersToAdd = [];

    // Add bot addresses from environment
    if (process.env.BOT_ADDRESS) {
        controllersToAdd.push({
            address: process.env.BOT_ADDRESS,
            name: 'Main Bot'
        });
    }

    // Add any backup bot
    if (process.env.BACKUP_BOT_ADDRESS) {
        controllersToAdd.push({
            address: process.env.BACKUP_BOT_ADDRESS,
            name: 'Backup Bot'
        });
    }

    // Add any monitoring address
    if (process.env.MONITOR_ADDRESS) {
        controllersToAdd.push({
            address: process.env.MONITOR_ADDRESS,
            name: 'Monitor'
        });
    }

    for (const controller of controllersToAdd) {
        const isController = await safetyTimer.isController(controller.address);

        if (isController) {
            console.log(`✅ ${controller.name} (${controller.address}) - Already controller`);
        } else {
            console.log(`Adding ${controller.name} (${controller.address})...`);

            try {
                const tx = await safetyTimer.addController(controller.address);
                await tx.wait();
                console.log(`✅ ${controller.name} added as controller`);
            } catch (err) {
                console.error(`❌ Failed to add ${controller.name}: ${err.message}`);
            }
        }
    }

    if (controllersToAdd.length === 0) {
        console.log("ℹ️  No controllers configured in .env");
        console.log("   Add BOT_ADDRESS to .env to configure");
    }

    // 2. Configure Protected Tokens
    console.log("\n2️⃣  Configuring Protected Tokens...");

    const protectedTokens = await safetyTimer.getProtectedTokens();
    console.log(`Currently protected: ${protectedTokens.length} tokens`);

    // Determine which tokens to protect
    const tokensToProtect = [];

    // Read from environment or use defaults
    if (process.env.PROTECTED_TOKENS) {
        // Comma-separated list in .env
        const tokenAddresses = process.env.PROTECTED_TOKENS.split(',');
        tokenAddresses.forEach(addr => {
            tokensToProtect.push({
                address: addr.trim(),
                name: 'Custom Token'
            });
        });
    } else {
        // Default: Protect major stablecoins and wrapped tokens
        console.log("Using default token list (USDT, USDC, DAI, WETH, WMATIC)");

        tokensToProtect.push(
            { address: COMMON_TOKENS.USDT, name: 'USDT' },
            { address: COMMON_TOKENS.USDC, name: 'USDC' },
            { address: COMMON_TOKENS.DAI, name: 'DAI' },
            { address: COMMON_TOKENS.WETH, name: 'WETH' },
            { address: COMMON_TOKENS.WMATIC, name: 'WMATIC' }
        );
    }

    for (const token of tokensToProtect) {
        const isProtected = protectedTokens.some(
            t => t.toLowerCase() === token.address.toLowerCase()
        );

        if (isProtected) {
            console.log(`✅ ${token.name} (${token.address}) - Already protected`);
        } else {
            console.log(`Adding ${token.name} (${token.address})...`);

            try {
                const tx = await safetyTimer.addProtectedToken(token.address);
                await tx.wait();
                console.log(`✅ ${token.name} added to protected list`);
            } catch (err) {
                console.error(`❌ Failed to add ${token.name}: ${err.message}`);
            }
        }
    }

    // 3. Configure Timelock Delay
    console.log("\n3️⃣  Configuring Timelock Delay...");

    const currentDelay = health.timelockDelaySeconds;
    const desiredDelay = process.env.TIMELOCK_HOURS
        ? parseInt(process.env.TIMELOCK_HOURS) * 3600
        : 24 * 3600; // Default 24 hours

    if (currentDelay === desiredDelay) {
        console.log(`✅ Timelock delay already set to ${desiredDelay / 3600} hours`);
    } else {
        console.log(`Updating timelock delay to ${desiredDelay / 3600} hours...`);

        try {
            const tx = await safetyTimer.setTimelockDelay(desiredDelay);
            await tx.wait();
            console.log(`✅ Timelock delay updated to ${desiredDelay / 3600} hours`);
        } catch (err) {
            console.error(`❌ Failed to update timelock: ${err.message}`);
        }
    }

    // Final Status
    console.log("\n" + "=".repeat(50));
    console.log("🎉 Configuration Complete!");
    console.log("=".repeat(50));

    const finalHealth = await safetyTimer.healthCheck();
    const finalProtected = await safetyTimer.getProtectedTokens();

    console.log("\n📊 Final Configuration:");
    console.log(`Timelock Delay: ${finalHealth.timelockDelaySeconds / 3600} hours`);
    console.log(`Protected Tokens: ${finalHealth.protectedTokenCount}`);

    if (finalProtected.length > 0) {
        console.log("\nProtected Tokens:");
        for (const token of finalProtected) {
            const tokenName = Object.keys(COMMON_TOKENS).find(
                key => COMMON_TOKENS[key].toLowerCase() === token.toLowerCase()
            ) || 'Unknown';
            console.log(`  - ${tokenName}: ${token}`);
        }
    }

    console.log("\n✅ SafetyTimer is fully configured and active!");

    console.log("\n📋 Next Steps:");
    console.log("1. Run: node monitor_safety_timer.js");
    console.log("   (Start real-time monitoring)");
    console.log("\n2. Test with a small transaction");
    console.log("   (Verify Safe owner transactions work)");

    console.log("\n⚠️  Configuration Tips:");
    console.log("- Add more tokens: safetyTimer.addProtectedToken(address)");
    console.log("- Add more controllers: safetyTimer.addController(address)");
    console.log("- Adjust timelock: safetyTimer.setTimelockDelay(seconds)");
}

// Run configuration
configureSafetyTimer()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Configuration failed:");
        console.error(error);
        process.exit(1);
    });
