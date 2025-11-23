// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * SimpleVault - Basic token storage contract
 *
 * This is a simple vault that accepts and stores tokens.
 * Only the owner can withdraw.
 *
 * Use this if you want a simple, straightforward vault.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SimpleVault {
    address public owner;

    event Received(address indexed from, uint256 amount);
    event TokenReceived(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * Accept MATIC deposits
     */
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /**
     * Accept any token transfers
     */
    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }

    /**
     * Emergency withdrawal of MATIC
     */
    function withdrawMatic(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        payable(owner).transfer(amount);
        emit Withdrawn(address(0), owner, amount);
    }

    /**
     * Emergency withdrawal of all MATIC
     */
    function withdrawAllMatic() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No MATIC to withdraw");
        payable(owner).transfer(balance);
        emit Withdrawn(address(0), owner, balance);
    }

    /**
     * Emergency withdrawal of ERC20 token
     */
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient balance");

        bool success = IERC20(token).transfer(owner, amount);
        require(success, "Transfer failed");

        emit Withdrawn(token, owner, amount);
    }

    /**
     * Emergency withdrawal of all of a token
     */
    function withdrawAllToken(address token) external onlyOwner {
        require(token != address(0), "Invalid token");

        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        bool success = IERC20(token).transfer(owner, balance);
        require(success, "Transfer failed");

        emit Withdrawn(token, owner, balance);
    }

    /**
     * Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }

    /**
     * Get MATIC balance
     */
    function getMaticBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * Get token balance
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
