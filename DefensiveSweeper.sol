// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * DefensiveSweeper - Safe Module for Emergency Token Sweeping
 *
 * This contract is designed to be added as a module to a Gnosis Safe.
 * It allows authorized bots to quickly sweep tokens from the Safe to a vault
 * in case of detected threats.
 *
 * Features:
 * - Whitelist of authorized bot addresses
 * - Sweep MATIC and ERC20 tokens
 * - Emergency sweep all functionality
 * - Health check for monitoring
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);

    function isOwner(address owner) external view returns (bool);
}

contract DefensiveSweeper {
    address public safe;
    address public immutable vault;
    address public immutable owner;

    mapping(address => bool) public authorizedBots;

    event BotAuthorized(address indexed bot);
    event BotDeauthorized(address indexed bot);
    event TokenSwept(address indexed token, uint256 amount, address indexed vault);
    event MaticSwept(uint256 amount, address indexed vault);

    modifier onlyOwner() {
        require(msg.sender == owner || (safe != address(0) && ISafe(safe).isOwner(msg.sender)), "Not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedBots[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    constructor(address _owner, address _vault) {
        require(_owner != address(0), "Owner cannot be zero");
        require(_vault != address(0), "Vault cannot be zero");

        owner = _owner;
        vault = _vault;
    }

    /**
     * Called by Safe when adding this as a module
     */
    function setUp(bytes calldata) external {
        require(safe == address(0), "Already initialized");
        safe = msg.sender;
    }

    /**
     * Manual setup if not using Safe's module system
     */
    function adminSetUp(address _safe) external onlyOwner {
        require(safe == address(0), "Already initialized");
        safe = _safe;
    }

    /**
     * Authorize a bot address to call sweep functions
     */
    function authorizeBot(address bot) external onlyOwner {
        require(bot != address(0), "Invalid bot address");
        authorizedBots[bot] = true;
        emit BotAuthorized(bot);
    }

    /**
     * Deauthorize a bot address
     */
    function deauthorizeBot(address bot) external onlyOwner {
        authorizedBots[bot] = false;
        emit BotDeauthorized(bot);
    }

    /**
     * Check if an address is authorized
     */
    function isAuthorized(address user) external view returns (bool) {
        return authorizedBots[user] || user == owner;
    }

    /**
     * Sweep specific amount of MATIC from Safe to vault
     */
    function sweepMaticAmount(uint256 amount) external onlyAuthorized {
        require(safe != address(0), "Not initialized");
        require(amount > 0, "Amount must be > 0");

        bytes memory data = "";
        bool success = ISafe(safe).execTransactionFromModule(
            vault,
            amount,
            data,
            0 // CALL operation
        );

        require(success, "MATIC transfer failed");
        emit MaticSwept(amount, vault);
    }

    /**
     * Sweep all MATIC from Safe to vault
     */
    function sweepMatic() external onlyAuthorized {
        require(safe != address(0), "Not initialized");

        uint256 balance = safe.balance;
        require(balance > 0, "No MATIC to sweep");

        bytes memory data = "";
        bool success = ISafe(safe).execTransactionFromModule(
            vault,
            balance,
            data,
            0
        );

        require(success, "MATIC transfer failed");
        emit MaticSwept(balance, vault);
    }

    /**
     * Emergency sweep all MATIC (alternative name for compatibility)
     */
    function sweepAllMaticNow() external onlyAuthorized {
        require(safe != address(0), "Not initialized");

        uint256 balance = safe.balance;
        if (balance == 0) return;

        bytes memory data = "";
        bool success = ISafe(safe).execTransactionFromModule(
            vault,
            balance,
            data,
            0
        );

        require(success, "MATIC transfer failed");
        emit MaticSwept(balance, vault);
    }

    /**
     * Sweep specific amount of ERC20 token from Safe to vault
     */
    function sweepTokenAmount(address tokenAddress, uint256 amount) external onlyAuthorized {
        require(safe != address(0), "Not initialized");
        require(tokenAddress != address(0), "Invalid token");
        require(amount > 0, "Amount must be > 0");

        bytes memory data = abi.encodeWithSelector(
            IERC20.transfer.selector,
            vault,
            amount
        );

        bool success = ISafe(safe).execTransactionFromModule(
            tokenAddress,
            0,
            data,
            0
        );

        require(success, "Token transfer failed");
        emit TokenSwept(tokenAddress, amount, vault);
    }

    /**
     * Sweep ALL of a specific ERC20 token from Safe to vault
     */
    function sweepToken(address tokenAddress) external onlyAuthorized {
        require(safe != address(0), "Not initialized");
        require(tokenAddress != address(0), "Invalid token");

        uint256 balance = IERC20(tokenAddress).balanceOf(safe);
        require(balance > 0, "No tokens to sweep");

        bytes memory data = abi.encodeWithSelector(
            IERC20.transfer.selector,
            vault,
            balance
        );

        bool success = ISafe(safe).execTransactionFromModule(
            tokenAddress,
            0,
            data,
            0
        );

        require(success, "Token transfer failed");
        emit TokenSwept(tokenAddress, balance, vault);
    }

    /**
     * Emergency sweep all tokens (batch operation)
     */
    function emergencySweepAll() external onlyAuthorized {
        require(safe != address(0), "Not initialized");

        // Sweep MATIC
        uint256 maticBalance = safe.balance;
        if (maticBalance > 0) {
            bytes memory data = "";
            ISafe(safe).execTransactionFromModule(vault, maticBalance, data, 0);
            emit MaticSwept(maticBalance, vault);
        }
    }

    /**
     * Get Safe's MATIC balance
     */
    function getSafeMaticBalance() external view returns (uint256) {
        if (safe == address(0)) return 0;
        return safe.balance;
    }

    /**
     * Get Vault's MATIC balance
     */
    function getVaultMaticBalance() external view returns (uint256) {
        return vault.balance;
    }

    /**
     * Get token balance in Safe
     */
    function getTokenBalance(address token) external view returns (uint256) {
        if (safe == address(0)) return 0;
        return IERC20(token).balanceOf(safe);
    }

    /**
     * Health check for monitoring
     * Returns: (isOwnerAuth, safeBalance, vaultBalance, owner, safe, vault)
     */
    function healthCheck() external view returns (
        bool isOwnerAuth,
        uint256 safeBalance,
        uint256 vaultBalance,
        address ownerAddr,
        address safeAddr,
        address vaultAddr
    ) {
        isOwnerAuth = (safe != address(0) && ISafe(safe).isOwner(owner));
        safeBalance = (safe != address(0)) ? safe.balance : 0;
        vaultBalance = vault.balance;
        ownerAddr = owner;
        safeAddr = safe;
        vaultAddr = vault;
    }
}
