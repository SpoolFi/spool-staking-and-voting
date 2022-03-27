// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "../external/@openzeppelin/token/ERC20/ERC20.sol";

// TEST
contract MockToken is ERC20 {
    constructor(
        string memory _name,
        string memory _symbol
    ) ERC20(_symbol, _name) {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}
