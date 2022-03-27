import { config as dotenvConfig } from "dotenv";
dotenvConfig();
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";

const config: HardhatUserConfig = {
	paths: {
		sources: "./contracts",
		cache: "./cache",
		artifacts: "./build",
		tests: "./test",
	},
	mocha: {
		timeout: 90000,
	},
	networks: {
		hardhat: {
			chainId: 1337,
			allowUnlimitedContractSize: false,
			hardfork: "london",
		},
	},
	gasReporter: {
		enabled: false,
	},
	typechain: {
		outDir: "build/types",
		target: "ethers-v5",
		alwaysGenerateOverloads: false,
	},
	solidity: {
		compilers: [
			{
				version: "0.8.13",
				settings: {
					optimizer: {
						enabled: true,
						runs: 99999,
					},
				},
			},
		],
	},
};

export default config;
