import { ethers } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getContractAddress } from "ethers/lib/utils";

// constants
export const TRIM_SIZE = BigNumber.from(10).pow(12);
export const SECS_DAY: number = 86400;
export const SECS_WEEK: number = 86400 * 7;
export const WEEKS_YEAR: number = 52;
export const WEEKS_3_YEARS: number = WEEKS_YEAR * 3;
export const SECS_3_YEARS: number = SECS_WEEK * WEEKS_3_YEARS; // time to fully-mature gradual voting power

export async function increase(seconds: BigNumberish) {
	await ethers.provider.send("evm_increaseTime", [BigNumber.from(seconds).toNumber()]);
	await ethers.provider.send("evm_mine", []);
}

export async function increaseTo(seconds: BigNumberish) {
	await ethers.provider.send("evm_setNextBlockTimestamp", [BigNumber.from(seconds).toNumber()]);
}

export async function increaseOneWeek() {
	await increase(SECS_WEEK);
}

export async function increaseWeeks(weeks: number) {
	await increase(SECS_WEEK * weeks);
}

export async function increaseThreeYears() {
	await increase(SECS_3_YEARS);
}

export function trim(amount: BigNumberish) {
	return BigNumber.from(amount).div(TRIM_SIZE);
}

export function getVotingPowerForWeeksPassed(amount: BigNumberish, weeksPassed: number) {
	if (weeksPassed >= WEEKS_3_YEARS) {
		return trim(amount).mul(TRIM_SIZE);
	}

	return trim(amount).mul(TRIM_SIZE).mul(weeksPassed).div(WEEKS_3_YEARS);
}

export async function getChainTimeInTwoDays() {
	return await getChainTime(SECS_DAY * 2);
}

export async function getChainTime(diff = 0) {
	await ethers.provider.send("evm_mine", []);
	const block = await ethers.provider.getBlock("latest");
	return block.timestamp + diff;
}

export async function getFutureContractAddress(signer: SignerWithAddress, skip: number = 0) {
	const transactionCount = (await signer.getTransactionCount()) + skip;

	return getContractAddress({
		from: signer.address,
		nonce: transactionCount,
	});
}
