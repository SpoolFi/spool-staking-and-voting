import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { VoSPOOL__factory, VoSPOOL, SpoolOwner__factory, SpoolOwner } from "../build/types";

import {
	increaseWeeks,
	increaseOneWeek,
	increaseThreeYears,
	getVotingPowerForWeeksPassed,
	trim,
	SECS_WEEK,
	SECS_3_YEARS,
	WEEKS_3_YEARS,
	getChainTime,
	getChainTimeInTwoDays,
} from "./shared/utilities";

use(solidity);

const { parseUnits } = ethers.utils;

async function getSigners() {
	const [deployer, owner, minter, gradualMinter, user1, user2, user3] = await ethers.getSigners();

	return {
		deployer,
		owner,
		minter,
		gradualMinter,
		user1,
		user2,
		user3,
	};
}

describe("VoSPOOL tests", () => {
	describe("VoSPOOL Deployment", () => {
		it("Should deploy the voSPOOL contract", async () => {
			// ARRANGE
			const { deployer, owner, user1 } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			const firstTrancheEndTime = await getChainTimeInTwoDays();

			// ACT
			const voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, firstTrancheEndTime);

			// ASSERT
			// erc20 values
			expect(await voSpool.name()).to.be.equal("Spool DAO Voting Token");
			expect(await voSpool.symbol()).to.be.equal("voSPOOL");
			expect(await voSpool.decimals()).to.be.equal(18);
			expect(await voSpool.totalSupply()).to.be.equal(0);
			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);

			// gradual power
			expect(await voSpool.FULL_POWER_TRANCHES_COUNT()).to.be.equal(WEEKS_3_YEARS);
			expect(await voSpool.TRANCHE_TIME()).to.be.equal(SECS_WEEK);
			expect(await voSpool.FULL_POWER_TIME()).to.be.equal(SECS_3_YEARS);

			expect(await voSpool.firstTrancheStartTime()).to.be.equal(firstTrancheEndTime - SECS_WEEK);
			expect(await voSpool.getNextTrancheEndTime()).to.be.equal(firstTrancheEndTime);
			expect(await voSpool.getCurrentTrancheIndex()).to.be.equal(1);
		});

		it("Deployment Gatekeeping", async () => {
			// ARRANGE
			const { deployer, owner } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			const voSpool = new VoSPOOL__factory().connect(deployer);

			// ACT / ASSERT
			await expect(voSpool.deploy(spoolOwner.address, await getChainTime(-1))).to.be.revertedWith(
				"voSPOOL::constructor: First tranche end time must be in the future"
			);

			// add some seconds to the chain time as next block time will slightly increase
			await expect(voSpool.deploy(spoolOwner.address, await getChainTime(SECS_WEEK + 100))).to.be.revertedWith(
				"voSPOOL::constructor: First tranche end time must be less than full tranche time in the future"
			);
		});
	});

	describe("Instant voting power", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;

		beforeEach("Deploy contracts and set minter", async () => {
			const { deployer, owner, minter } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());

			await voSpool.connect(owner).setMinter(minter.address, true);

			voSpool = voSpool.connect(minter);
		});

		it("Should mint instant power to user", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mint(user1.address, mintAmount);

			// ASSERT
			expect(await voSpool.userInstantPower(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.totalInstantPower()).to.be.equal(mintAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.totalSupply()).to.be.equal(mintAmount);
		});

		it("Should mint instant power to multiple users", async () => {
			// ARRANGE
			const { user1, user2, user3 } = await getSigners();

			const mintAmount1 = parseUnits("1000");
			const mintAmount2 = parseUnits("2000");
			const mintAmount3 = parseUnits("3000");

			const totalMintAmount = mintAmount1.add(mintAmount2).add(mintAmount3);

			// ACT
			await voSpool.mint(user1.address, mintAmount1);
			await voSpool.mint(user2.address, mintAmount2);
			await voSpool.mint(user3.address, mintAmount3);

			// ASSERT
			expect(await voSpool.userInstantPower(user1.address)).to.be.equal(mintAmount1);
			expect(await voSpool.userInstantPower(user2.address)).to.be.equal(mintAmount2);
			expect(await voSpool.userInstantPower(user3.address)).to.be.equal(mintAmount3);
			expect(await voSpool.totalInstantPower()).to.be.equal(totalMintAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(mintAmount1);
			expect(await voSpool.balanceOf(user2.address)).to.be.equal(mintAmount2);
			expect(await voSpool.balanceOf(user3.address)).to.be.equal(mintAmount3);
			expect(await voSpool.totalSupply()).to.be.equal(totalMintAmount);
		});

		it("Should burn instant power from user", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");
			await voSpool.mint(user1.address, mintAmount);

			// ACT
			const burnAmount = mintAmount.div(2);
			await voSpool.burn(user1.address, burnAmount);

			// ACT / ASSERT
			expect(await voSpool.userInstantPower(user1.address)).to.be.equal(mintAmount.sub(burnAmount));

			await voSpool.burn(user1.address, burnAmount);
			expect(await voSpool.userInstantPower(user1.address)).to.be.equal(0);
		});

		it("Burn more than user amount, should revert", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mint(user1.address, mintAmount);

			expect(await voSpool.userInstantPower(user1.address)).to.be.equal(mintAmount);

			// ACT / ASSERT
			const burnAmount = mintAmount.mul(2);
			await expect(voSpool.burn(user1.address, burnAmount)).to.be.revertedWith(
				"voSPOOL:burn: User instant power balance too low"
			);
		});

		it("Mint and burn as a user, should revert", async () => {
			// ARRANGE
			const { user1, user2 } = await getSigners();

			const amount = parseUnits("1000");

			// ACT / ASSERT
			await expect(voSpool.connect(user1).mint(user2.address, amount)).to.be.revertedWith(
				"voSPOOL::_onlyMinter: Insufficient Privileges"
			);

			await expect(voSpool.connect(user1).burn(user2.address, amount)).to.be.revertedWith(
				"voSPOOL::_onlyMinter: Insufficient Privileges"
			);
		});
	});

	describe("Gradual voting power", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;

		beforeEach("Deploy contracts and set minter", async () => {
			const { deployer, owner, gradualMinter } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());

			await voSpool.connect(owner).setGradualMinter(gradualMinter.address, true);

			voSpool = voSpool.connect(gradualMinter);
		});

		it("Mint gradual power to user, user should have 0 power at first", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.totalInstantPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);
		});

		it("Mint gradual power to user, user should have 1/156th power after a week", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseOneWeek();

			// ASSERT
			const expectedMaturedAmount = getVotingPowerForWeeksPassed(mintAmount, 1);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount);
		});

		it("Mint gradual power to user, user should have 52/156th power after 52 weeks", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			const weeksPassed52 = 52;
			await increaseWeeks(weeksPassed52);

			// ASSERT
			const expectedMaturedAmount = getVotingPowerForWeeksPassed(mintAmount, weeksPassed52);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount);
		});

		it("Mint gradual power to user, user should have full power after 156 weeks", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(156);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(mintAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.totalSupply()).to.be.equal(mintAmount);
		});

		it("Mint gradual power to user, user should have full power after 157 weeks", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(157);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(mintAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.totalSupply()).to.be.equal(mintAmount);
		});

		it("Mint gradual power to user, user should have full power after 156 weeks and on", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(180);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(mintAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(mintAmount);
			expect(await voSpool.totalSupply()).to.be.equal(mintAmount);
		});

		it("Should mint instant power to multiple users", async () => {
			// ARRANGE
			const { user1, user2, user3 } = await getSigners();

			const mintAmount1 = parseUnits("1000");
			const mintAmount2 = parseUnits("2000");
			const mintAmount3 = parseUnits("3000");

			const totalMintAmount = mintAmount1.add(mintAmount2).add(mintAmount3);

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount1);
			await voSpool.mintGradual(user2.address, mintAmount2);
			await voSpool.mintGradual(user3.address, mintAmount3);
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);

			// ASSERT
			const expectedMaturedAmount1 = getVotingPowerForWeeksPassed(mintAmount1, weeksPassed);
			const expectedMaturedAmount2 = getVotingPowerForWeeksPassed(mintAmount2, weeksPassed);
			const expectedMaturedAmount3 = getVotingPowerForWeeksPassed(mintAmount3, weeksPassed);
			const expectedMaturedAmountTotal = getVotingPowerForWeeksPassed(totalMintAmount, weeksPassed);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.getUserGradualVotingPower(user2.address)).to.be.equal(expectedMaturedAmount2);
			expect(await voSpool.getUserGradualVotingPower(user3.address)).to.be.equal(expectedMaturedAmount3);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmountTotal);
		});

		it("Wait 200 weeks, mint instant power to multiple users", async () => {
			// ARRANGE
			await increaseWeeks(200);

			const { user1, user2, user3 } = await getSigners();

			const mintAmount1 = parseUnits("1000");
			const mintAmount2 = parseUnits("2000");
			const mintAmount3 = parseUnits("3000");

			const totalMintAmount = mintAmount1.add(mintAmount2).add(mintAmount3);

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount1);
			await voSpool.mintGradual(user2.address, mintAmount2);
			await voSpool.mintGradual(user3.address, mintAmount3);
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);

			// ASSERT
			const expectedMaturedAmount1 = getVotingPowerForWeeksPassed(mintAmount1, weeksPassed);
			const expectedMaturedAmount2 = getVotingPowerForWeeksPassed(mintAmount2, weeksPassed);
			const expectedMaturedAmount3 = getVotingPowerForWeeksPassed(mintAmount3, weeksPassed);
			const expectedMaturedAmountTotal = getVotingPowerForWeeksPassed(totalMintAmount, weeksPassed);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.getUserGradualVotingPower(user2.address)).to.be.equal(expectedMaturedAmount2);
			expect(await voSpool.getUserGradualVotingPower(user3.address)).to.be.equal(expectedMaturedAmount3);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmountTotal);
		});

		it("Mint gradual power to user over multiple periods", async () => {
			// ARRANGE
			await increaseWeeks(200);

			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			const weeksPassed = 52;
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(weeksPassed);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(weeksPassed);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(weeksPassed);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(weeksPassed);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(weeksPassed);

			// ASSERT
			const expectedMaturedAmount1 = getVotingPowerForWeeksPassed(mintAmount, weeksPassed);
			const expectedMaturedAmount2 = getVotingPowerForWeeksPassed(mintAmount, weeksPassed * 2);
			const expectedMaturedAmount3 = getVotingPowerForWeeksPassed(mintAmount, weeksPassed * 3);
			const expectedMaturedAmount4 = getVotingPowerForWeeksPassed(mintAmount, weeksPassed * 4);
			const expectedMaturedAmount5 = getVotingPowerForWeeksPassed(mintAmount, weeksPassed * 5);

			const expectedMaturedAmountTotal = expectedMaturedAmount1
				.add(expectedMaturedAmount2)
				.add(expectedMaturedAmount3)
				.add(expectedMaturedAmount4)
				.add(expectedMaturedAmount5);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.closeTo(expectedMaturedAmountTotal, 1);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.closeTo(expectedMaturedAmountTotal, 1);

			expect(await voSpool.balanceOf(user1.address)).to.be.closeTo(expectedMaturedAmountTotal, 1);
			expect(await voSpool.totalSupply()).to.be.closeTo(expectedMaturedAmountTotal, 1);
		});

		it("Mint gradual power to user over multiple periods and wait for all to mature, should have full power in amount of all mints", async () => {
			// ARRANGE
			await increaseWeeks(104);

			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseThreeYears();

			await voSpool.updateVotingPower();

			// ASSERT
			const expectedMaturedAmount = mintAmount.mul(5);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount);
		});

		it("Mint 0 gradual power to user, should return without action", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			// ACT
			await voSpool.mintGradual(user1.address, 0);

			// ASSERT
			// user gradual
			const userGradual = await voSpool.getUserGradual(user1.address);

			expect(userGradual.maturingAmount).to.be.equal(0);
			expect(userGradual.rawUnmaturedVotingPower).to.be.equal(0);
			expect(userGradual.maturedVotingPower).to.be.equal(0);
			expect(userGradual.oldestTranchePosition.arrayIndex).to.be.equal(0);
			expect(userGradual.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradual.latestTranchePosition.arrayIndex).to.be.equal(0);
			expect(userGradual.latestTranchePosition.position).to.be.equal(0);
			expect(userGradual.lastUpdatedTrancheIndex).to.be.equal(0);

			// global gradual
			const globalGradual = await voSpool.getGlobalGradual();

			expect(globalGradual.totalMaturingAmount).to.be.equal(0);
			expect(globalGradual.totalRawUnmaturedVotingPower).to.be.equal(0);
			expect(globalGradual.totalMaturedVotingPower).to.be.equal(0);
			expect(globalGradual.lastUpdatedTrancheIndex).to.be.equal(0);
		});

		it("Mint and burn gradual power to user, user and global gradual should change values accordingly", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			// ACT - mint gradual 3 times
			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.mintGradual(user1.address, mintAmount);

			// ASSERT
			const userAmount = trim(mintAmount.mul(3));
			// user gradual
			const userGradual = await voSpool.getUserGradual(user1.address);

			expect(userGradual.maturingAmount).to.be.equal(userAmount);
			expect(userGradual.rawUnmaturedVotingPower).to.be.equal(0);
			expect(userGradual.maturedVotingPower).to.be.equal(0);
			expect(userGradual.oldestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradual.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual.latestTranchePosition.position).to.be.equal(0);
			expect(userGradual.lastUpdatedTrancheIndex).to.be.equal(0);

			// global gradual
			const globalGradual = await voSpool.getGlobalGradual();

			expect(globalGradual.totalMaturingAmount).to.be.equal(userAmount);
			expect(globalGradual.totalRawUnmaturedVotingPower).to.be.equal(0);
			expect(globalGradual.totalMaturedVotingPower).to.be.equal(0);
			expect(globalGradual.lastUpdatedTrancheIndex).to.be.equal(0);

			// ARRANGE - pass 52 weeks
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);

			// ASSERT
			// user gradual
			const userGradual52weeks = await voSpool.getUserGradual(user1.address);

			expect(userGradual52weeks.maturingAmount).to.be.equal(userAmount);
			expect(userGradual52weeks.rawUnmaturedVotingPower).to.be.equal(userAmount.mul(weeksPassed));
			expect(userGradual52weeks.maturedVotingPower).to.be.equal(0);
			expect(userGradual52weeks.oldestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual52weeks.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradual52weeks.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual52weeks.latestTranchePosition.position).to.be.equal(0);
			expect(userGradual52weeks.lastUpdatedTrancheIndex).to.be.equal(52);

			// global gradual
			const globalGradual52weeks = await voSpool.getGlobalGradual();

			expect(globalGradual52weeks.totalMaturingAmount).to.be.equal(userAmount);
			expect(globalGradual52weeks.totalRawUnmaturedVotingPower).to.be.equal(userAmount.mul(weeksPassed));
			expect(globalGradual52weeks.totalMaturedVotingPower).to.be.equal(0);
			expect(globalGradual52weeks.lastUpdatedTrancheIndex).to.be.equal(52);

			// ACT - mint gradual 1 time
			await voSpool.mintGradual(user1.address, mintAmount);

			// ASSERT
			const userMint2 = trim(mintAmount);
			const userAmount2 = userAmount.add(userMint2);

			// user gradual
			const userGradual52weeks2 = await voSpool.getUserGradual(user1.address);

			expect(userGradual52weeks2.maturingAmount).to.be.equal(userAmount2);
			expect(userGradual52weeks2.rawUnmaturedVotingPower).to.be.equal(userAmount.mul(weeksPassed));
			expect(userGradual52weeks2.maturedVotingPower).to.be.equal(0);
			expect(userGradual52weeks2.oldestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual52weeks2.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradual52weeks2.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual52weeks2.latestTranchePosition.position).to.be.equal(1);
			expect(userGradual52weeks2.lastUpdatedTrancheIndex).to.be.equal(52);

			// global gradual
			const globalGradual52weeks2 = await voSpool.getGlobalGradual();

			expect(globalGradual52weeks2.totalMaturingAmount).to.be.equal(userAmount2);
			expect(globalGradual52weeks2.totalRawUnmaturedVotingPower).to.be.equal(userAmount.mul(weeksPassed));
			expect(globalGradual52weeks2.totalMaturedVotingPower).to.be.equal(0);
			expect(globalGradual52weeks2.lastUpdatedTrancheIndex).to.be.equal(52);

			// ARRANGE - pass 104 weeks
			const weeksPassed104 = 104;
			await increaseWeeks(weeksPassed104);

			// ASSERT
			// user gradual
			const userGradual104weeks = await voSpool.getUserGradual(user1.address);

			expect(userGradual104weeks.maturingAmount).to.be.equal(userMint2);
			expect(userGradual104weeks.rawUnmaturedVotingPower).to.be.equal(userMint2.mul(weeksPassed104));
			expect(userGradual104weeks.maturedVotingPower).to.be.equal(userAmount);
			expect(userGradual104weeks.oldestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual104weeks.oldestTranchePosition.position).to.be.equal(1);
			expect(userGradual104weeks.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradual104weeks.latestTranchePosition.position).to.be.equal(1);
			expect(userGradual104weeks.lastUpdatedTrancheIndex).to.be.equal(156);

			// global gradual
			const globalGradual104weeks = await voSpool.getGlobalGradual();

			expect(globalGradual104weeks.totalMaturingAmount).to.be.equal(userMint2);
			expect(globalGradual104weeks.totalRawUnmaturedVotingPower).to.be.equal(userMint2.mul(weeksPassed104));
			expect(globalGradual104weeks.totalMaturedVotingPower).to.be.equal(userAmount);
			expect(globalGradual104weeks.lastUpdatedTrancheIndex).to.be.equal(156);

			// ARRANGE - pass 60 weeks
			const weeksPassed60 = 60;
			await increaseWeeks(weeksPassed60);

			// ASSERT
			// user gradual
			const userGradualAllMatured = await voSpool.getUserGradual(user1.address);

			expect(userGradualAllMatured.maturingAmount).to.be.equal(0);
			expect(userGradualAllMatured.rawUnmaturedVotingPower).to.be.equal(0);
			expect(userGradualAllMatured.maturedVotingPower).to.be.equal(userAmount2);
			expect(userGradualAllMatured.oldestTranchePosition.arrayIndex).to.be.equal(0);
			expect(userGradualAllMatured.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradualAllMatured.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradualAllMatured.latestTranchePosition.position).to.be.equal(1);
			expect(userGradualAllMatured.lastUpdatedTrancheIndex).to.be.equal(216);

			// global gradual
			const globalGradualAllMatured = await voSpool.getGlobalGradual();

			expect(globalGradualAllMatured.totalMaturingAmount).to.be.equal(0);
			expect(globalGradualAllMatured.totalRawUnmaturedVotingPower).to.be.equal(0);
			expect(globalGradualAllMatured.totalMaturedVotingPower).to.be.equal(userAmount2);
			expect(globalGradualAllMatured.lastUpdatedTrancheIndex).to.be.equal(216);

			// ACT - burn gradual partial amount
			await voSpool.burnGradual(user1.address, mintAmount, false);

			// ASSERT
			// user gradual
			const userAmountAfterBurn = userAmount2.sub(trim(mintAmount));
			const userGradualAfterBurn = await voSpool.getUserGradual(user1.address);

			expect(userGradualAfterBurn.maturingAmount).to.be.equal(userAmountAfterBurn);
			expect(userGradualAfterBurn.rawUnmaturedVotingPower).to.be.equal(0);
			expect(userGradualAfterBurn.maturedVotingPower).to.be.equal(0);
			expect(userGradualAfterBurn.oldestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradualAfterBurn.oldestTranchePosition.position).to.be.equal(2);
			expect(userGradualAfterBurn.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradualAfterBurn.latestTranchePosition.position).to.be.equal(2);
			expect(userGradualAfterBurn.lastUpdatedTrancheIndex).to.be.equal(216);

			// global gradual
			const globalGradualAfterBurn = await voSpool.getGlobalGradual();

			expect(globalGradualAfterBurn.totalMaturingAmount).to.be.equal(userAmountAfterBurn);
			expect(globalGradualAfterBurn.totalRawUnmaturedVotingPower).to.be.equal(0);
			expect(globalGradualAfterBurn.totalMaturedVotingPower).to.be.equal(0);
			expect(globalGradualAfterBurn.lastUpdatedTrancheIndex).to.be.equal(216);

			// ARRANGE - pass 3 years (fully-mature all amounts)
			await increaseThreeYears();

			// ASSERT
			// user gradual
			const userGradualAllMatured2 = await voSpool.getUserGradual(user1.address);

			expect(userGradualAllMatured2.maturingAmount).to.be.equal(0);
			expect(userGradualAllMatured2.rawUnmaturedVotingPower).to.be.equal(0);
			expect(userGradualAllMatured2.maturedVotingPower).to.be.equal(userAmountAfterBurn);
			expect(userGradualAllMatured2.oldestTranchePosition.arrayIndex).to.be.equal(0);
			expect(userGradualAllMatured2.oldestTranchePosition.position).to.be.equal(0);
			expect(userGradualAllMatured2.latestTranchePosition.arrayIndex).to.be.equal(1);
			expect(userGradualAllMatured2.latestTranchePosition.position).to.be.equal(2);
			expect(userGradualAllMatured2.lastUpdatedTrancheIndex).to.be.equal(372);

			// global gradual
			const globalGradualAllMatured2 = await voSpool.getGlobalGradual();

			expect(globalGradualAllMatured2.totalMaturingAmount).to.be.equal(0);
			expect(globalGradualAllMatured2.totalRawUnmaturedVotingPower).to.be.equal(0);
			expect(globalGradualAllMatured2.totalMaturedVotingPower).to.be.equal(userAmountAfterBurn);
			expect(globalGradualAllMatured2.lastUpdatedTrancheIndex).to.be.equal(372);
		});

		it("Burn all gradual power from user, all gradual user power should reset", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			// ACT
			await voSpool.burnGradual(user1.address, mintAmount, false);
			await increaseWeeks(52);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);
		});

		it("Burn all gradual power from user (using burnAll flag), all gradual user power should reset", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			// ACT
			await voSpool.burnGradual(user1.address, 0, true);
			await increaseWeeks(52);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);
		});

		it("Burn gradual power from user in same tranche as mint multiple times, all gradual user power should reset and start accumulating again", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			const burnAmount = mintAmount.div(2);

			// ACT
			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.burnGradual(user1.address, burnAmount, false);
			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.burnGradual(user1.address, mintAmount, false);
			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.burnGradual(user1.address, mintAmount, false);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);

			// ARRANGE wait for 52 weeks to pass, to accumulate power
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);
			await voSpool.updateVotingPower();

			// ASSERT
			const expectedMaturedAmount = getVotingPowerForWeeksPassed(mintAmount.sub(burnAmount), weeksPassed);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount);
		});

		it("Burn half gradual power from user, all gradual user power should reset and start accumulating again", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			const burnAmount = mintAmount.div(2);

			// ACT
			await voSpool.burnGradual(user1.address, burnAmount, false);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);

			// ARRANGE wait for 52 weeks to pass, to accumulate power
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);
			await voSpool.updateVotingPower();

			// ASSERT
			const expectedMaturedAmount = getVotingPowerForWeeksPassed(mintAmount.sub(burnAmount), weeksPassed);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount);
		});

		it("Burn gradual power from user (round up amount), burn amount should round up by 1", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseWeeks(52);

			const burnAmount = mintAmount.div(2).add(1);

			// ACT
			await voSpool.burnGradual(user1.address, burnAmount, false);

			// ASSERT
			// user gradual
			const burnAmountRoundUp = trim(burnAmount).add(1);
			const userAmountTrimmed = trim(mintAmount).sub(burnAmountRoundUp);

			const userGradual = await voSpool.getUserGradual(user1.address);
			expect(userGradual.maturingAmount).to.be.equal(userAmountTrimmed);

			// global gradual
			const globalGradual = await voSpool.getGlobalGradual();
			expect(globalGradual.totalMaturingAmount).to.be.equal(userAmountTrimmed);
		});

		it("Mint gradual to user 1 and 2, burn gradual from user 1, user 2 power should stay the same", async () => {
			// ARRANGE
			const { user1, user2 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await voSpool.mintGradual(user2.address, mintAmount);
			const weeksPassed = 52;
			await increaseWeeks(weeksPassed);

			const burnAmount = mintAmount.div(2);

			// ACT burn gradual partial amount 2 times 500
			await voSpool.burnGradual(user1.address, burnAmount, false);
			const user1PowerAmount = mintAmount.sub(burnAmount);

			// ASSERT
			const user2expectedMaturedAmount52Weeks = getVotingPowerForWeeksPassed(mintAmount, weeksPassed);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getUserGradualVotingPower(user2.address)).to.be.equal(
				user2expectedMaturedAmount52Weeks
			);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(user2expectedMaturedAmount52Weeks);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.balanceOf(user2.address)).to.be.equal(user2expectedMaturedAmount52Weeks);
			expect(await voSpool.totalSupply()).to.be.equal(user2expectedMaturedAmount52Weeks);

			// ARRANGE wait for 52 weeks to pass, to accumulate power
			await increaseWeeks(weeksPassed);
			await voSpool.updateVotingPower();

			// ASSERT
			const user1expectedMaturedAmount52Weeks = getVotingPowerForWeeksPassed(user1PowerAmount, weeksPassed);
			const user2expectedMaturedAmount104Weeks = getVotingPowerForWeeksPassed(mintAmount, weeksPassed * 2);
			const expectedMaturedAmountTotal = user2expectedMaturedAmount104Weeks.add(
				user1expectedMaturedAmount52Weeks
			);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(
				user1expectedMaturedAmount52Weeks
			);
			expect(await voSpool.getUserGradualVotingPower(user2.address)).to.be.equal(
				user2expectedMaturedAmount104Weeks
			);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.closeTo(expectedMaturedAmountTotal, 1);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(user1expectedMaturedAmount52Weeks);
			expect(await voSpool.balanceOf(user2.address)).to.be.equal(user2expectedMaturedAmount104Weeks);
			expect(await voSpool.totalSupply()).to.be.closeTo(expectedMaturedAmountTotal, 1);

			// ARRANGE wait for both users power to fully-mature
			await increaseThreeYears();
			await voSpool.updateVotingPower();

			// ASSERT
			const user2PowerAmount = mintAmount;
			const totalPower = user1PowerAmount.add(user2PowerAmount);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(user1PowerAmount);
			expect(await voSpool.getUserGradualVotingPower(user2.address)).to.be.equal(user2PowerAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(totalPower);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(user1PowerAmount);
			expect(await voSpool.balanceOf(user2.address)).to.be.equal(user2PowerAmount);
			expect(await voSpool.totalSupply()).to.be.equal(totalPower);
		});

		it("Burn gradual power from user multiple times, all gradual user power should reset and start accumulating again every time", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			await voSpool.mintGradual(user1.address, mintAmount);
			await increaseThreeYears();

			const burnAmount = mintAmount.div(10);

			// ACT - burn gradual partial amount
			await voSpool.burnGradual(user1.address, burnAmount, false);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);

			// ARRANGE wait for 60 weeks to pass, to accumulate power
			await increaseWeeks(60);

			// ACT - burn gradual partial amount 2 times 100
			await voSpool.burnGradual(user1.address, burnAmount, false);
			await voSpool.burnGradual(user1.address, burnAmount, false);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);

			// ARRANGE wait for 1 week to pass, to accumulate power
			const weeksPassed1 = 1;
			await increaseWeeks(weeksPassed1);

			// ASSERT
			const userAmountAfterBurn = mintAmount.sub(burnAmount.mul(3));
			const expectedMaturedAmount1 = getVotingPowerForWeeksPassed(userAmountAfterBurn, weeksPassed1);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount1);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount1);

			// ACT - mint gradual 2000
			const mintAmount2 = parseUnits("2000");
			await voSpool.mintGradual(user1.address, mintAmount2);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount1);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount1);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmount1);

			// ARRANGE pass 155 weeks
			const weeksPassed155 = 155;
			await increaseWeeks(weeksPassed155);

			// ASSERT
			const userAmountEnd1 = userAmountAfterBurn.add(mintAmount2);
			const expectedMaturedAmount2 = getVotingPowerForWeeksPassed(
				userAmountAfterBurn,
				weeksPassed1 + weeksPassed155
			);
			const expectedMaturedAmount3 = getVotingPowerForWeeksPassed(mintAmount2, weeksPassed155);
			const expectedMaturedAmountTotal1 = expectedMaturedAmount2.add(expectedMaturedAmount3);

			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmountTotal1);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmountTotal1);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmountTotal1);
			expect(await voSpool.totalSupply()).to.be.equal(expectedMaturedAmountTotal1);

			// ARRANGE pass 1 week
			await increaseOneWeek();

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(userAmountEnd1);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(userAmountEnd1);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(userAmountEnd1);
			expect(await voSpool.totalSupply()).to.be.equal(userAmountEnd1);

			// ACT - burn gradual partial amount 100
			await voSpool.burnGradual(user1.address, burnAmount, false);

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);

			// ARRANGE wait for power to fully-mature
			await increaseThreeYears();
			await voSpool.updateUserVotingPower(user1.address);

			// ASSERT
			const userAmountEnd2 = userAmountEnd1.sub(burnAmount);
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(userAmountEnd2);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(userAmountEnd2);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(userAmountEnd2);
			expect(await voSpool.totalSupply()).to.be.equal(userAmountEnd2);

			// ACT - burn gradual all
			await voSpool.burnGradual(user1.address, 0, true);

			// ARRANGE wait for power to fully-mature
			await increaseThreeYears();

			// ASSERT
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);
			expect(await voSpool.totalSupply()).to.be.equal(0);
		});

		// this test is skipped as it requires more time to execute (remove .skip to run it)
		it.skip("Mint gradual power to user every tranche, should mature power respectively until fully-matured", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const mintAmount = parseUnits("1000");

			let totalDeposited = ethers.constants.Zero;
			let rawVotingPower = ethers.constants.Zero;

			// increase time to simulate a random user entering at random time
			await increaseWeeks(20);

			// mint every tranche
			for (let i = 0; i < WEEKS_3_YEARS; i++) {
				// ARRANGE pass one week
				await increaseOneWeek();
				console.log("minting week:", i);

				// ACT mint gradual 1000
				await voSpool.mintGradual(user1.address, mintAmount);

				// ASSERT
				rawVotingPower = rawVotingPower.add(totalDeposited);
				totalDeposited = totalDeposited.add(mintAmount);

				const votingPower = rawVotingPower.div(WEEKS_3_YEARS);
				expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(votingPower);
				expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(votingPower);
			}

			// wait for all tranches to fully-mature
			let maturingPower = totalDeposited;
			for (let i = 0; i < WEEKS_3_YEARS; i++) {
				// ARRANGE pass one week
				await increaseOneWeek();
				console.log("waiting week:", i);
				await voSpool.updateUserVotingPower(user1.address);

				// ASSERT
				rawVotingPower = rawVotingPower.add(maturingPower);
				maturingPower = maturingPower.sub(mintAmount);

				const votingPower = rawVotingPower.div(WEEKS_3_YEARS);
				expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(votingPower);
				expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(votingPower);
			}

			// ARRANGE pass one week
			await increaseOneWeek();

			// ASSERT
			await voSpool.updateUserVotingPower(user1.address);
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(totalDeposited);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(totalDeposited);
		});

		it.skip("Mint gradual power to user every tranche, burn all after", async () => {
			// ARRANGE
			const { user1, user2 } = await getSigners();

			const mintAmount = parseUnits("1000");

			let totalDeposited = ethers.constants.Zero;

			// increase time to simulate a random user entering at random time
			await increaseWeeks(20);

			// mint every tranche
			for (let i = 0; i < WEEKS_3_YEARS; i++) {
				console.log("minting week:", i);

				// mint gradual 1000
				await voSpool.mintGradual(user1.address, mintAmount);

				totalDeposited = totalDeposited.add(mintAmount);
				await increaseOneWeek();
			}

			// ACT gradual burn 1000
			await voSpool.burnGradual(user1.address, mintAmount, false);
			totalDeposited = totalDeposited.sub(mintAmount);

			// ASSERT should have 0 power
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(0);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(0);

			// ARRANGE pass one week
			await increaseOneWeek();

			const expectedMaturedAmount = getVotingPowerForWeeksPassed(totalDeposited, 1);

			// ASSERT should have 1 week of power
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(expectedMaturedAmount);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(expectedMaturedAmount);

			// ARRANGE pass 3 years (fully-mature all amounts)
			await increaseThreeYears();

			// ASSERT should have total deposited power
			await voSpool.updateUserVotingPower(user1.address);
			expect(await voSpool.getUserGradualVotingPower(user1.address)).to.be.equal(totalDeposited);
			expect(await voSpool.getTotalGradualVotingPower()).to.be.equal(totalDeposited);
		});

		it("Test get tranche index and time view functions", async () => {
			// ARRANGE
			let firstTrancheStartTime = await voSpool.firstTrancheStartTime();

			// ACT / ASSERT
			let trancheEndTime = await voSpool.getTrancheEndTime(0);
			expect(trancheEndTime).to.be.equal(firstTrancheStartTime);

			let block = await ethers.provider.getBlock("latest");

			// revert if time before the first tranche is passed
			await expect(voSpool.getTrancheIndex(block.timestamp - SECS_WEEK)).to.be.revertedWith(
				"voSPOOL::getTrancheIndex: Time must be more or equal to the first tranche time"
			);

			let index = await voSpool.getTrancheIndex(block.timestamp);
			expect(index).to.be.equal(1);

			trancheEndTime = await voSpool.getTrancheEndTime(1);
			expect(trancheEndTime).to.be.equal(firstTrancheStartTime.add(SECS_WEEK));

			// ARRANGE pass 1 week
			const weeksPassed1 = 1;
			await increaseWeeks(weeksPassed1);

			// ACT / ASSERT
			block = await ethers.provider.getBlock("latest");
			index = await voSpool.getTrancheIndex(block.timestamp);
			expect(index).to.be.equal(weeksPassed1 + 1);

			trancheEndTime = await voSpool.getTrancheEndTime(weeksPassed1 + 1);
			expect(trancheEndTime).to.be.equal(firstTrancheStartTime.add(SECS_WEEK * (weeksPassed1 + 1)));

			// ARRANGE pass 50 weeks
			const weeksPassed50 = 50;
			await increaseWeeks(weeksPassed50);

			// ACT / ASSERT
			block = await ethers.provider.getBlock("latest");
			index = await voSpool.getTrancheIndex(block.timestamp);
			expect(index).to.be.equal(weeksPassed1 + weeksPassed50 + 1);

			trancheEndTime = await voSpool.getTrancheEndTime(weeksPassed1 + weeksPassed50 + 1);
			expect(trancheEndTime).to.be.equal(
				firstTrancheStartTime.add(SECS_WEEK * (weeksPassed1 + weeksPassed50 + 1))
			);
		});

		it("Mint and burn as a user, should revert", async () => {
			// ARRANGE
			const { user1, user2 } = await getSigners();
			const amount = parseUnits("1000");

			// ACT / ASSERT
			await expect(voSpool.connect(user1).mintGradual(user2.address, amount)).to.be.revertedWith(
				"voSPOOL::_onlyGradualMinter: Insufficient Privileges"
			);

			await expect(voSpool.connect(user1).burnGradual(user2.address, amount, false)).to.be.revertedWith(
				"voSPOOL::_onlyGradualMinter: Insufficient Privileges"
			);
		});
	});

	describe("Contract owner functions", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;

		beforeEach("Deploy contracts", async () => {
			const { deployer, owner } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());
			voSpool = voSpool.connect(owner);
		});

		it("Should add minting rights", async () => {
			// ARRANGE
			const { gradualMinter, minter } = await getSigners();

			expect(await voSpool.minters(minter.address)).to.be.false;
			expect(await voSpool.gradualMinters(gradualMinter.address)).to.be.false;

			// ACT
			await voSpool.setMinter(minter.address, true);
			await voSpool.setGradualMinter(gradualMinter.address, true);

			// ASSERT
			expect(await voSpool.minters(minter.address)).to.be.true;
			expect(await voSpool.gradualMinters(gradualMinter.address)).to.be.true;
		});

		it("Should remove minting rights", async () => {
			// ARRANGE
			const { gradualMinter, minter } = await getSigners();

			await voSpool.setMinter(minter.address, true);
			await voSpool.setGradualMinter(gradualMinter.address, true);

			// ACT
			await voSpool.setMinter(minter.address, false);
			await voSpool.setGradualMinter(gradualMinter.address, false);

			// ASSERT
			expect(await voSpool.minters(minter.address)).to.be.false;
			expect(await voSpool.gradualMinters(gradualMinter.address)).to.be.false;
		});

		it("Set minter as zero address, should revert", async () => {
			// ACT / ASSERT
			await expect(voSpool.setMinter(ethers.constants.AddressZero, true)).to.be.revertedWith(
				"voSPOOL::setMinter: minter cannot be the zero address"
			);

			await expect(voSpool.setGradualMinter(ethers.constants.AddressZero, true)).to.be.revertedWith(
				"voSPOOL::setGradualMinter: gradual minter cannot be the zero address"
			);
		});

		it("Set minter as user, should revert", async () => {
			// ARRANGE
			const { user1, gradualMinter, minter } = await getSigners();

			// ACT / ASSERT
			await expect(voSpool.connect(user1).setMinter(minter.address, true)).to.be.revertedWith(
				"SpoolOwnable::onlyOwner: Caller is not the Spool owner"
			);

			await expect(voSpool.connect(user1).setGradualMinter(gradualMinter.address, true)).to.be.revertedWith(
				"SpoolOwnable::onlyOwner: Caller is not the Spool owner"
			);
		});
	});

	describe("Contract ERC20 prohibited functions", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;

		beforeEach("Deploy contracts", async () => {
			const { deployer, owner } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());
			voSpool = voSpool.connect(owner);
		});

		it("Test prohibited actions, should revert", async () => {
			// ACT / ASSERT
			await expect(voSpool.transfer(ethers.constants.AddressZero, 100)).to.be.revertedWith(
				"voSPOOL::transfer: Prohibited Action"
			);

			await expect(
				voSpool.transferFrom(ethers.constants.AddressZero, ethers.constants.AddressZero, 100)
			).to.be.revertedWith("voSPOOL::transferFrom: Prohibited Action");

			await expect(voSpool.approve(ethers.constants.AddressZero, 100)).to.be.revertedWith(
				"voSPOOL::approve: Prohibited Action"
			);

			await expect(
				voSpool.allowance(ethers.constants.AddressZero, ethers.constants.AddressZero)
			).to.be.revertedWith("voSPOOL::allowance: Prohibited Action");
		});
	});
});
