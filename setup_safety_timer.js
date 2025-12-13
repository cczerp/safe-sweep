const { ethers } = require('ethers');
const Safe = require('@safe-global/safe-core-sdk').default;
const { EthersAdapter } = require('@safe-global/safe-ethers-lib');
require('dotenv').config();

const SAFE_ABI = [
    "function enableModule(address module) external",
    "function setGuard(address guard) external",
    "function isModuleEnabled(address module) external view returns (bool)",
    "function getGuard() external view returns (address)",
    "function getOwners() external view returns (address[] memory)"
];

async function setupSafetyTimer() {
    console.log("🔧 SafetyTimerModule Setup Script\n");
    console.log("=".repeat(50));

    // Validate environment
    if (!process.env.SAFETY_TIMER_ADDRESS) {
        throw new Error("SAFETY_TIMER_ADDRESS not set. Run deploy_safety_timer.js first");
    }

    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    console.log("\n📋 Configuration:");
    console.log(`Wallet: ${wallet.address}`);
    console.log(`Safe: ${process.env.SAFE_ADDRESS}`);
    console.log(`SafetyTimer: ${process.env.SAFETY_TIMER_ADDRESS}`);
    console.log(`Vault: ${process.env.VAULT_ADDRESS}`);

    // Check if wallet is Safe owner
    const safe = new ethers.Contract(process.env.SAFE_ADDRESS, SAFE_ABI, wallet);
    const owners = await safe.getOwners();

    console.log(`\nSafe Owners: ${owners.join(', ')}`);

    if (!owners.map(o => o.toLowerCase()).includes(wallet.address.toLowerCase())) {
        throw new Error(`Wallet ${wallet.address} is not a Safe owner!`);
    }

    console.log("✅ Wallet is a Safe owner");

    // Initialize Safe SDK
    console.log("\n🔌 Initializing Safe SDK...");

    const ethAdapter = new EthersAdapter({
        ethers,
        signerOrProvider: wallet
    });

    const safeSdk = await Safe.create({
        ethAdapter,
        safeAddress: process.env.SAFE_ADDRESS
    });

    console.log("✅ Safe SDK initialized");

    // Step 1: Enable Module
    console.log("\n1️⃣  Enabling SafetyTimer as module...");

    const isModuleEnabled = await safe.isModuleEnabled(process.env.SAFETY_TIMER_ADDRESS);

    if (isModuleEnabled) {
        console.log("✅ Module already enabled");
    } else {
        console.log("Enabling module...");

        const enableModuleTx = await safeSdk.createEnableModuleTx(
            process.env.SAFETY_TIMER_ADDRESS
        );

        const executeTxResponse = await safeSdk.executeTransaction(enableModuleTx);
        const receipt = await executeTxResponse.transactionResponse.wait();

        console.log(`✅ Module enabled! Tx: ${receipt.transactionHash}`);
    }

    // Step 2: Set Guard
    console.log("\n2️⃣  Setting SafetyTimer as transaction guard...");

    const currentGuard = await safe.getGuard();

    if (currentGuard.toLowerCase() === process.env.SAFETY_TIMER_ADDRESS.toLowerCase()) {
        console.log("✅ Guard already set");
    } else {
        if (currentGuard !== ethers.constants.AddressZero) {
            console.log(`⚠️  Warning: Replacing existing guard: ${currentGuard}`);
        }

        console.log("Setting guard...");

        // Create transaction to set guard
        const setGuardData = safe.interface.encodeFunctionData('setGuard', [
            process.env.SAFETY_TIMER_ADDRESS
        ]);

        const safeTransaction = await safeSdk.createTransaction({
            safeTransactionData: {
                to: process.env.SAFE_ADDRESS,
                value: '0',
                data: setGuardData
            }
        });

        const executeTxResponse = await safeSdk.executeTransaction(safeTransaction);
        const receipt = await executeTxResponse.transactionResponse.wait();

        console.log(`✅ Guard set! Tx: ${receipt.transactionHash}`);
    }

    // Step 3: Initialize SafetyTimer
    console.log("\n3️⃣  Initializing SafetyTimer with Safe address...");

    const safetyTimerAbi = [
        "function adminSetUp(address _safe) external",
        "function safe() external view returns (address)"
    ];

    const safetyTimer = new ethers.Contract(
        process.env.SAFETY_TIMER_ADDRESS,
        safetyTimerAbi,
        wallet
    );

    const safeAddress = await safetyTimer.safe();

    if (safeAddress === process.env.SAFE_ADDRESS) {
        console.log("✅ SafetyTimer already initialized");
    } else if (safeAddress === ethers.constants.AddressZero) {
        console.log("Initializing...");

        const tx = await safetyTimer.adminSetUp(process.env.SAFE_ADDRESS);
        await tx.wait();

        console.log("✅ SafetyTimer initialized");
    } else {
        console.log(`⚠️  Warning: SafetyTimer linked to different Safe: ${safeAddress}`);
    }

    // Verification
    console.log("\n🔍 Verifying setup...");

    const isEnabled = await safe.isModuleEnabled(process.env.SAFETY_TIMER_ADDRESS);
    const guard = await safe.getGuard();

    console.log(`Module Enabled: ${isEnabled ? '✅' : '❌'}`);
    console.log(`Guard Set: ${guard.toLowerCase() === process.env.SAFETY_TIMER_ADDRESS.toLowerCase() ? '✅' : '❌'}`);

    if (isEnabled && guard.toLowerCase() === process.env.SAFETY_TIMER_ADDRESS.toLowerCase()) {
        console.log("\n" + "=".repeat(50));
        console.log("🎉 Setup Complete!");
        console.log("=".repeat(50));

        console.log("\n✅ SafetyTimer is now active!");
        console.log("✅ All transactions will be intercepted");
        console.log("✅ Unauthorized transfers will be queued");
        console.log("✅ Malicious attempts will be blocked and swept");

        console.log("\n📋 Next Steps:");
        console.log("1. Run: node configure_safety_timer.js");
        console.log("   (Add controllers and protected tokens)");
        console.log("\n2. Run: node monitor_safety_timer.js");
        console.log("   (Start monitoring)");
        console.log("\n3. Test with small transaction");

        console.log("\n⚠️  IMPORTANT:");
        console.log("All Safe transactions will now go through SafetyTimer!");
        console.log("Safe owners bypass all checks automatically.");
    } else {
        console.log("\n❌ Setup incomplete. Please check errors above.");
    }
}

// Run setup
setupSafetyTimer()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Setup failed:");
        console.error(error);
        process.exit(1);
    });
