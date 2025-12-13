const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// SafetyTimerModule ABI (minimal for deployment)
const SAFETY_TIMER_ABI = [
    "constructor(address _owner, address _vault)",
    "function setUp(bytes calldata) external",
    "function adminSetUp(address _safe) external",
    "function addController(address controller) external",
    "function addProtectedToken(address token) external",
    "function setTimelockDelay(uint256 newDelay) external",
    "function healthCheck() external view returns (bool isInitialized, bool isEmergencyMode, uint256 pendingCount, uint256 timelockDelaySeconds, address safeAddr, address vaultAddr, uint256 protectedTokenCount)",
    "event ControllerAdded(address indexed controller)",
    "event ProtectedTokenAdded(address indexed token)"
];

// Safe interface
const SAFE_ABI = [
    "function enableModule(address module) external",
    "function setGuard(address guard) external",
    "function isModuleEnabled(address module) external view returns (bool)",
    "function getGuard() external view returns (address)"
];

async function deploySafetyTimer() {
    console.log("🔒 SafetyTimerModule Deployment Script\n");
    console.log("=".repeat(50));

    // Validate environment
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY not set in .env");
    }
    if (!process.env.RPC_URL) {
        throw new Error("RPC_URL not set in .env");
    }
    if (!process.env.SAFE_ADDRESS) {
        throw new Error("SAFE_ADDRESS not set in .env");
    }
    if (!process.env.VAULT_ADDRESS) {
        throw new Error("VAULT_ADDRESS not set in .env");
    }

    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    console.log("\n📋 Configuration:");
    console.log(`Deployer: ${wallet.address}`);
    console.log(`Safe Address: ${process.env.SAFE_ADDRESS}`);
    console.log(`Vault Address: ${process.env.VAULT_ADDRESS}`);
    console.log(`Network: ${(await provider.getNetwork()).name}`);

    // Check balance
    const balance = await wallet.getBalance();
    console.log(`\nDeployer Balance: ${ethers.utils.formatEther(balance)} MATIC`);

    if (balance.lt(ethers.utils.parseEther("0.1"))) {
        console.warn("⚠️  Warning: Low balance. Deployment may fail.");
    }

    // Read compiled bytecode
    // Note: You need to compile SafetyTimerModule.sol first
    // Using: solc --optimize --bin SafetyTimerModule.sol
    console.log("\n📦 Reading compiled contract...");

    let bytecode;
    try {
        // Try to read from compiled output
        const compiled = JSON.parse(fs.readFileSync('./SafetyTimerModule.json', 'utf8'));
        bytecode = compiled.bytecode;
    } catch (err) {
        console.log("ℹ️  SafetyTimerModule.json not found.");
        console.log("   Please compile the contract first:");
        console.log("   npm install -g solc");
        console.log("   solc --optimize --bin --abi SafetyTimerModule.sol -o ./build");
        console.log("\n   Or deploy via Remix/Hardhat");

        // Provide manual deployment instructions
        console.log("\n📝 Manual Deployment:");
        console.log("1. Open https://remix.ethereum.org");
        console.log("2. Upload SafetyTimerModule.sol");
        console.log("3. Compile with Solidity 0.8.0+");
        console.log("4. Deploy with parameters:");
        console.log(`   - _owner: ${wallet.address}`);
        console.log(`   - _vault: ${process.env.VAULT_ADDRESS}`);
        console.log("5. Copy deployed address to .env as SAFETY_TIMER_ADDRESS");
        console.log("\nThen run: node setup_safety_timer.js");
        return;
    }

    // Deploy
    console.log("\n🚀 Deploying SafetyTimerModule...");

    const factory = new ethers.ContractFactory(
        SAFETY_TIMER_ABI,
        bytecode,
        wallet
    );

    const safetyTimer = await factory.deploy(
        wallet.address,  // owner
        process.env.VAULT_ADDRESS  // vault
    );

    console.log(`Transaction hash: ${safetyTimer.deployTransaction.hash}`);
    console.log("Waiting for confirmation...");

    await safetyTimer.deployed();

    console.log(`\n✅ SafetyTimerModule deployed at: ${safetyTimer.address}`);

    // Save to .env
    console.log("\n💾 Saving to .env file...");

    let envContent = fs.readFileSync('.env', 'utf8');
    if (envContent.includes('SAFETY_TIMER_ADDRESS=')) {
        envContent = envContent.replace(
            /SAFETY_TIMER_ADDRESS=.*/,
            `SAFETY_TIMER_ADDRESS=${safetyTimer.address}`
        );
    } else {
        envContent += `\nSAFETY_TIMER_ADDRESS=${safetyTimer.address}\n`;
    }
    fs.writeFileSync('.env', envContent);

    console.log("✅ Address saved to .env");

    // Verify deployment
    console.log("\n🔍 Verifying deployment...");
    const health = await safetyTimer.healthCheck();
    console.log(`Vault: ${health.vaultAddr}`);
    console.log(`Initialized: ${health.isInitialized}`);

    console.log("\n" + "=".repeat(50));
    console.log("✅ Deployment Complete!");
    console.log("=".repeat(50));

    console.log("\n📋 Next Steps:");
    console.log("1. Run: node setup_safety_timer.js");
    console.log("   (This will enable module and set guard)");
    console.log("\n2. Run: node configure_safety_timer.js");
    console.log("   (This will add controllers and protected tokens)");
    console.log("\n3. Run: node monitor_safety_timer.js");
    console.log("   (This will start monitoring)");

    console.log("\n⚠️  IMPORTANT:");
    console.log("The module must be enabled AND set as guard!");
    console.log("Run setup_safety_timer.js to complete this.");

    return safetyTimer.address;
}

// Run deployment
deploySafetyTimer()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("\n❌ Deployment failed:");
        console.error(error);
        process.exit(1);
    });
