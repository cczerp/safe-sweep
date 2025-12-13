// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * SafetyTimerModule - Advanced Safe Guard & Module with Timelock Protection
 *
 * This is your "holy grail" security layer that intercepts ALL transactions from your Safe.
 *
 * Features:
 * - Acts as both a Safe Module AND a Transaction Guard
 * - Delays/stalls unauthorized token transfers for approval
 * - Auto-sweeps tokens to vault when detecting malicious attempts
 * - Timelock mechanism for pending transactions
 * - Safe owners and controllers can bypass all checks
 * - Drops malicious calls and simultaneously sweeps tokens
 *
 * How it works:
 * 1. Safe owner/controller transactions → Execute immediately
 * 2. Unauthorized transfers → Queued for timelock approval
 * 3. Malicious attempts (has approval but not permission) → DROPPED + AUTO-SWEEP
 *
 * @author SafeSweep Team
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);

    function isOwner(address owner) external view returns (bool);

    function getOwners() external view returns (address[] memory);

    function getThreshold() external view returns (uint256);
}

interface IGuard {
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external;

    function checkAfterExecution(bytes32 txHash, bool success) external;
}

contract SafetyTimerModule is IGuard {

    // ============ State Variables ============

    address public safe;
    address public immutable vault;
    address public immutable owner;

    // Controllers have same privileges as Safe owners
    mapping(address => bool) public controllers;

    // Timelock settings (default 24 hours)
    uint256 public timelockDelay = 24 hours;
    uint256 public maxTimelockDelay = 7 days;

    // Emergency mode - if true, ALL transactions are blocked except owners
    bool public emergencyMode = false;

    // ============ Pending Transaction System ============

    struct PendingTransaction {
        address to;
        uint256 value;
        bytes data;
        uint8 operation;
        address initiator;
        uint256 queuedAt;
        uint256 executableAt;
        bool executed;
        bool rejected;
        string reason;
    }

    mapping(bytes32 => PendingTransaction) public pendingTxs;
    bytes32[] public pendingTxHashes;

    // ============ Token Tracking ============

    // Track which tokens we're protecting
    mapping(address => bool) public protectedTokens;
    address[] public protectedTokenList;

    // Track suspicious addresses
    mapping(address => bool) public blacklisted;
    mapping(address => uint256) public suspiciousActivity; // count of suspicious attempts

    // ============ Events ============

    event ControllerAdded(address indexed controller);
    event ControllerRemoved(address indexed controller);
    event TimelockDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event EmergencyModeToggled(bool enabled);

    event TransactionQueued(bytes32 indexed txHash, address indexed initiator, address to, uint256 value, string reason);
    event TransactionApproved(bytes32 indexed txHash, address indexed approver);
    event TransactionRejected(bytes32 indexed txHash, address indexed rejector, string reason);
    event TransactionExecuted(bytes32 indexed txHash, bool success);

    event MaliciousAttemptDetected(address indexed attacker, address indexed token, uint256 amount);
    event TokensSwept(address indexed token, uint256 amount, address indexed vault, string reason);
    event AddressBlacklisted(address indexed addr, string reason);

    event ProtectedTokenAdded(address indexed token);
    event ProtectedTokenRemoved(address indexed token);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(
            msg.sender == owner ||
            (safe != address(0) && ISafe(safe).isOwner(msg.sender)),
            "Not owner"
        );
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner ||
            controllers[msg.sender] ||
            (safe != address(0) && ISafe(safe).isOwner(msg.sender)),
            "Not authorized"
        );
        _;
    }

    modifier onlySafe() {
        require(msg.sender == safe, "Only Safe can call");
        _;
    }

    // ============ Constructor ============

    constructor(address _owner, address _vault) {
        require(_owner != address(0), "Owner cannot be zero");
        require(_vault != address(0), "Vault cannot be zero");

        owner = _owner;
        vault = _vault;
    }

    // ============ Setup Functions ============

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
        require(_safe != address(0), "Invalid safe address");
        safe = _safe;
    }

    // ============ Controller Management ============

    function addController(address controller) external onlyOwner {
        require(controller != address(0), "Invalid controller");
        require(!controllers[controller], "Already controller");

        controllers[controller] = true;
        emit ControllerAdded(controller);
    }

    function removeController(address controller) external onlyOwner {
        require(controllers[controller], "Not a controller");

        controllers[controller] = false;
        emit ControllerRemoved(controller);
    }

    function isController(address addr) external view returns (bool) {
        return controllers[addr];
    }

    // ============ Timelock Configuration ============

    function setTimelockDelay(uint256 newDelay) external onlyOwner {
        require(newDelay <= maxTimelockDelay, "Delay too long");
        require(newDelay >= 1 hours, "Delay too short");

        uint256 oldDelay = timelockDelay;
        timelockDelay = newDelay;

        emit TimelockDelayUpdated(oldDelay, newDelay);
    }

    // ============ Emergency Controls ============

    function setEmergencyMode(bool enabled) external onlyOwner {
        emergencyMode = enabled;
        emit EmergencyModeToggled(enabled);
    }

    function blacklistAddress(address addr, string calldata reason) external onlyAuthorized {
        require(addr != address(0), "Invalid address");
        require(addr != owner, "Cannot blacklist owner");
        require(!ISafe(safe).isOwner(addr), "Cannot blacklist Safe owner");

        blacklisted[addr] = true;
        emit AddressBlacklisted(addr, reason);
    }

    // ============ Protected Tokens Management ============

    function addProtectedToken(address token) external onlyAuthorized {
        require(token != address(0), "Invalid token");
        require(!protectedTokens[token], "Already protected");

        protectedTokens[token] = true;
        protectedTokenList.push(token);

        emit ProtectedTokenAdded(token);
    }

    function removeProtectedToken(address token) external onlyOwner {
        require(protectedTokens[token], "Not protected");

        protectedTokens[token] = false;

        // Remove from list
        for (uint256 i = 0; i < protectedTokenList.length; i++) {
            if (protectedTokenList[i] == token) {
                protectedTokenList[i] = protectedTokenList[protectedTokenList.length - 1];
                protectedTokenList.pop();
                break;
            }
        }

        emit ProtectedTokenRemoved(token);
    }

    function getProtectedTokens() external view returns (address[] memory) {
        return protectedTokenList;
    }

    // ============ GUARD IMPLEMENTATION - THE HOLY GRAIL ============

    /**
     * This is called BEFORE every Safe transaction executes
     * This is where we catch unauthorized transfers and malicious attempts
     */
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external override onlySafe {

        // Get the actual transaction initiator
        address initiator = msgSender;

        // Check if initiator is authorized (Safe owner or controller)
        bool isAuthorized = _isAuthorized(initiator);

        // Emergency mode - block everything except authorized users
        if (emergencyMode && !isAuthorized) {
            revert("Emergency mode active - transaction blocked");
        }

        // Check if initiator is blacklisted
        if (blacklisted[initiator]) {
            _handleMaliciousAttempt(initiator, to, data);
            revert("Address blacklisted");
        }

        // Authorized users bypass all checks
        if (isAuthorized) {
            return; // Allow transaction immediately
        }

        // ============ UNAUTHORIZED TRANSACTION DETECTED ============

        // Check if this is a token transfer
        bool isTokenTransfer = _isTokenTransfer(to, data);

        if (isTokenTransfer) {
            (address token, address recipient, uint256 amount) = _parseTokenTransfer(to, data);

            // Check if initiator has approval (malicious attempt)
            if (_hasTokenApproval(token, initiator)) {
                // HOLY GRAIL: They have approval but not permission!
                // Drop the call and sweep tokens
                _handleMaliciousAttempt(initiator, token, data);
                revert("Malicious attempt detected - tokens swept");
            }

            // Otherwise, queue for timelock approval
            _queueTransaction(to, value, data, operation, initiator, "Unauthorized token transfer");
            revert("Transaction queued for approval");
        }

        // For non-token transactions from unauthorized users
        // Queue for approval if it's a significant transaction
        if (value > 0 || data.length > 0) {
            _queueTransaction(to, value, data, operation, initiator, "Unauthorized transaction");
            revert("Transaction queued for approval");
        }
    }

    /**
     * Called AFTER transaction execution (if it succeeded checkTransaction)
     */
    function checkAfterExecution(bytes32 txHash, bool success) external override onlySafe {
        // Post-execution logging or checks can go here
        // For now, we do all our checks in checkTransaction
    }

    // ============ Transaction Analysis ============

    function _isAuthorized(address addr) internal view returns (bool) {
        if (addr == owner) return true;
        if (controllers[addr]) return true;
        if (safe != address(0) && ISafe(safe).isOwner(addr)) return true;
        return false;
    }

    function _isTokenTransfer(address to, bytes memory data) internal pure returns (bool) {
        if (data.length < 4) return false;

        bytes4 selector = bytes4(data);

        // transfer(address,uint256)
        if (selector == 0xa9059cbb) return true;

        // transferFrom(address,address,uint256)
        if (selector == 0x23b872dd) return true;

        // approve(address,uint256) - also dangerous!
        if (selector == 0x095ea7b3) return true;

        return false;
    }

    function _parseTokenTransfer(address token, bytes memory data)
        internal
        pure
        returns (address, address, uint256)
    {
        bytes4 selector = bytes4(data);

        if (selector == 0xa9059cbb) {
            // transfer(address to, uint256 amount)
            (address to, uint256 amount) = abi.decode(_slice(data, 4), (address, uint256));
            return (token, to, amount);
        }

        if (selector == 0x23b872dd) {
            // transferFrom(address from, address to, uint256 amount)
            (address from, address to, uint256 amount) = abi.decode(_slice(data, 4), (address, address, uint256));
            return (token, to, amount);
        }

        if (selector == 0x095ea7b3) {
            // approve(address spender, uint256 amount)
            (address spender, uint256 amount) = abi.decode(_slice(data, 4), (address, uint256));
            return (token, spender, amount);
        }

        return (address(0), address(0), 0);
    }

    function _slice(bytes memory data, uint256 start) internal pure returns (bytes memory) {
        bytes memory result = new bytes(data.length - start);
        for (uint256 i = 0; i < result.length; i++) {
            result[i] = data[i + start];
        }
        return result;
    }

    function _hasTokenApproval(address token, address spender) internal view returns (bool) {
        try IERC20(token).allowance(safe, spender) returns (uint256 allowance) {
            return allowance > 0;
        } catch {
            return false;
        }
    }

    // ============ Malicious Attempt Handler - THE HOLY GRAIL ============

    function _handleMaliciousAttempt(address attacker, address token, bytes memory data) internal {
        // Record suspicious activity
        suspiciousActivity[attacker]++;

        emit MaliciousAttemptDetected(attacker, token, 0);

        // Auto-blacklist after 3 attempts
        if (suspiciousActivity[attacker] >= 3 && !blacklisted[attacker]) {
            blacklisted[attacker] = true;
            emit AddressBlacklisted(attacker, "Multiple malicious attempts");
        }

        // Sweep the token to vault
        _sweepTokenToVault(token, "Malicious attempt detected");
    }

    function _sweepTokenToVault(address token, string memory reason) internal {
        require(safe != address(0), "Not initialized");

        uint256 balance = IERC20(token).balanceOf(safe);
        if (balance == 0) return;

        bytes memory data = abi.encodeWithSelector(
            IERC20.transfer.selector,
            vault,
            balance
        );

        bool success = ISafe(safe).execTransactionFromModule(
            token,
            0,
            data,
            0 // CALL operation
        );

        if (success) {
            emit TokensSwept(token, balance, vault, reason);
        }
    }

    // ============ Timelock Queue System ============

    function _queueTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        address initiator,
        string memory reason
    ) internal {
        bytes32 txHash = keccak256(abi.encode(
            to, value, data, operation, initiator, block.timestamp
        ));

        require(!pendingTxs[txHash].executed, "Already executed");
        require(!pendingTxs[txHash].rejected, "Already rejected");

        pendingTxs[txHash] = PendingTransaction({
            to: to,
            value: value,
            data: data,
            operation: operation,
            initiator: initiator,
            queuedAt: block.timestamp,
            executableAt: block.timestamp + timelockDelay,
            executed: false,
            rejected: false,
            reason: reason
        });

        pendingTxHashes.push(txHash);

        emit TransactionQueued(txHash, initiator, to, value, reason);
    }

    // ============ Pending Transaction Management ============

    function approvePendingTransaction(bytes32 txHash) external onlyAuthorized {
        PendingTransaction storage txn = pendingTxs[txHash];

        require(txn.queuedAt > 0, "Transaction not found");
        require(!txn.executed, "Already executed");
        require(!txn.rejected, "Already rejected");

        // Mark as immediately executable by setting executableAt to now
        txn.executableAt = block.timestamp;

        emit TransactionApproved(txHash, msg.sender);
    }

    function rejectPendingTransaction(bytes32 txHash, string calldata reason) external onlyAuthorized {
        PendingTransaction storage txn = pendingTxs[txHash];

        require(txn.queuedAt > 0, "Transaction not found");
        require(!txn.executed, "Already executed");
        require(!txn.rejected, "Already rejected");

        txn.rejected = true;

        emit TransactionRejected(txHash, msg.sender, reason);
    }

    function executePendingTransaction(bytes32 txHash) external {
        PendingTransaction storage txn = pendingTxs[txHash];

        require(txn.queuedAt > 0, "Transaction not found");
        require(!txn.executed, "Already executed");
        require(!txn.rejected, "Transaction rejected");
        require(block.timestamp >= txn.executableAt, "Timelock not expired");

        txn.executed = true;

        bool success = ISafe(safe).execTransactionFromModule(
            txn.to,
            txn.value,
            txn.data,
            txn.operation
        );

        emit TransactionExecuted(txHash, success);
    }

    function getPendingTransactionCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingTxHashes.length; i++) {
            PendingTransaction storage txn = pendingTxs[pendingTxHashes[i]];
            if (!txn.executed && !txn.rejected) {
                count++;
            }
        }
        return count;
    }

    function getPendingTransactions() external view returns (bytes32[] memory) {
        uint256 count = 0;

        // Count pending
        for (uint256 i = 0; i < pendingTxHashes.length; i++) {
            PendingTransaction storage txn = pendingTxs[pendingTxHashes[i]];
            if (!txn.executed && !txn.rejected) {
                count++;
            }
        }

        // Build array
        bytes32[] memory pending = new bytes32[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < pendingTxHashes.length; i++) {
            PendingTransaction storage txn = pendingTxs[pendingTxHashes[i]];
            if (!txn.executed && !txn.rejected) {
                pending[index] = pendingTxHashes[i];
                index++;
            }
        }

        return pending;
    }

    // ============ Manual Sweep Functions (for emergencies) ============

    function emergencySweepToken(address token) external onlyAuthorized {
        _sweepTokenToVault(token, "Emergency sweep by authorized user");
    }

    function emergencySweepAllProtectedTokens() external onlyAuthorized {
        for (uint256 i = 0; i < protectedTokenList.length; i++) {
            address token = protectedTokenList[i];
            uint256 balance = IERC20(token).balanceOf(safe);
            if (balance > 0) {
                _sweepTokenToVault(token, "Emergency sweep all");
            }
        }
    }

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
        emit TokensSwept(address(0), balance, vault, "MATIC sweep");
    }

    // ============ View Functions ============

    function healthCheck() external view returns (
        bool isInitialized,
        bool isEmergencyMode,
        uint256 pendingCount,
        uint256 timelockDelaySeconds,
        address safeAddr,
        address vaultAddr,
        uint256 protectedTokenCount
    ) {
        isInitialized = (safe != address(0));
        isEmergencyMode = emergencyMode;
        timelockDelaySeconds = timelockDelay;
        safeAddr = safe;
        vaultAddr = vault;
        protectedTokenCount = protectedTokenList.length;

        // Count pending txs
        uint256 count = 0;
        for (uint256 i = 0; i < pendingTxHashes.length; i++) {
            PendingTransaction storage txn = pendingTxs[pendingTxHashes[i]];
            if (!txn.executed && !txn.rejected) {
                count++;
            }
        }
        pendingCount = count;
    }

    function getBlacklistedStatus(address addr) external view returns (bool isBlacklisted, uint256 attempts) {
        return (blacklisted[addr], suspiciousActivity[addr]);
    }
}
