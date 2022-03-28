import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import {
	VoSpoolRewards__factory,
	VoSPOOL__factory,
	VoSPOOL,
	SpoolOwner__factory,
	SpoolOwner,
	VoSpoolRewards,
} from "../build/types";
import { BasisPoints } from "./shared/chaiExtension/chaiExtAssertions";

import {
	increaseWeeks,
	increaseOneWeek,
	getVotingPowerForWeeksPassed,
	trim,
	WEEKS_3_YEARS,
	getChainTimeInTwoDays,
} from "./shared/utilities";

use(solidity);

const { parseUnits } = ethers.utils;

async function getSigners() {
	const [deployer, owner, gradualMinter, spoolStaking, user1, user2, user3] = await ethers.getSigners();

	return {
		deployer,
		owner,
		gradualMinter,
		spoolStaking,
		user1,
		user2,
		user3,
	};
}

describe("VoSpoolRewards tests", () => {
	describe("Contract setup tests", () => {
		it("Should deploy the VoSpoolRewards properly", async () => {
			// ARRANGE
			const { deployer, owner, spoolStaking } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			const voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());

			// ACT
			const voSpoolRewards = await new VoSpoolRewards__factory()
				.connect(deployer)
				.deploy(spoolStaking.address, voSpool.address, spoolOwner.address);

			// ASSERT
			expect(await voSpoolRewards.spoolStaking()).to.be.equal(spoolStaking.address);
			expect(await voSpoolRewards.voSpool()).to.be.equal(voSpool.address);
		});
	});

	describe("Reward configuration", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;
		let voSpoolRewards: VoSpoolRewards;

		before("Deploy SpoolOwner contract", async () => {
			const { owner } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
		});

		beforeEach("Deploy contracts", async () => {
			const { deployer, spoolStaking, owner } = await getSigners();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());
			voSpoolRewards = await new VoSpoolRewards__factory()
				.connect(deployer)
				.deploy(spoolStaking.address, voSpool.address, spoolOwner.address);

			voSpoolRewards = voSpoolRewards.connect(owner);
		});

		describe("Test updateVoSpoolRewardRate", () => {
			it("Should add new reward configuration", async () => {
				// ARRANGE
				const rewardPerTranche = parseUnits("1000");
				const toTranche = 5;

				// ACT
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(1);
				expect(config.hasRewards).to.be.equal(true);
				expect(config.lastSetRewardTranche).to.be.equal(toTranche);

				const voSpoolRewardRates = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates.one.fromTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());
				expect(voSpoolRewardRates.one.toTranche).to.be.equal(toTranche);
				expect(voSpoolRewardRates.one.rewardPerTranche).to.be.equal(rewardPerTranche);
			});

			it("Should update reward configuration", async () => {
				// ARRANGE
				const rewardPerTranche1 = parseUnits("100");
				const toTranche1 = 4;

				const rewardPerTranche2 = parseUnits("1000");
				const toTranche2 = 5;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche1, rewardPerTranche1);
				await increaseOneWeek();

				// ACT
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche2, rewardPerTranche2);

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(2);
				expect(config.hasRewards).to.be.equal(true);
				expect(config.lastSetRewardTranche).to.be.equal(toTranche2);

				const voSpoolRewardRates0 = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates0.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates0.one.fromTranche).to.be.equal(1);
				expect(voSpoolRewardRates0.one.toTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());
				expect(voSpoolRewardRates0.one.rewardPerTranche).to.be.equal(rewardPerTranche1);

				const voSpoolRewardRates1 = await voSpoolRewards.voSpoolRewardRates(1);

				expect(voSpoolRewardRates1.zero.fromTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());
				expect(voSpoolRewardRates1.zero.toTranche).to.be.equal(toTranche2);
				expect(voSpoolRewardRates1.zero.rewardPerTranche).to.be.equal(rewardPerTranche2);
			});

			it("Update reward configuration in same week, should override configuration", async () => {
				// ARRANGE
				const rewardPerTranche1 = parseUnits("100");
				const toTranche1 = 4;

				const rewardPerTranche2 = parseUnits("1000");
				const toTranche2 = 5;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche1, rewardPerTranche1);

				// ACT
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche2, rewardPerTranche2);

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(1);
				expect(config.hasRewards).to.be.equal(true);
				expect(config.lastSetRewardTranche).to.be.equal(toTranche2);

				const voSpoolRewardRates0 = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates0.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates0.one.fromTranche).to.be.equal(1);
				expect(voSpoolRewardRates0.one.toTranche).to.be.equal(toTranche2);
				expect(voSpoolRewardRates0.one.rewardPerTranche).to.be.equal(rewardPerTranche2);

				const voSpoolRewardRates1 = await voSpoolRewards.voSpoolRewardRates(1);
				expect(voSpoolRewardRates1.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates1.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates1.zero.rewardPerTranche).to.be.equal(0);
			});

			it("Update reward configuration with reward rate 0, should revert", async () => {
				// ACT / ASSERT
				await expect(voSpoolRewards.updateVoSpoolRewardRate(4, 0)).to.be.revertedWith(
					"VoSpoolRewards::updateVoSpoolRewardRate: Cannot update reward rate to 0"
				);
			});

			it("Update reward configuration to after tranches start fully-maturing, should revert", async () => {
				// ACT / ASSERT
				await expect(voSpoolRewards.updateVoSpoolRewardRate(WEEKS_3_YEARS + 1, 1000)).to.be.revertedWith(
					"VoSpoolRewards::updateVoSpoolRewardRate: Cannot set rewards after power starts maturing"
				);
			});

			it("Update reward configuration for finished tranche, should revert", async () => {
				// ARRANGE
				const rewardPerTranche = parseUnits("1000");
				const toTranche1 = 4;
				const toTranche2 = 3;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche1, rewardPerTranche);
				await increaseWeeks(3);

				// ACT / ASSERT
				await expect(voSpoolRewards.updateVoSpoolRewardRate(toTranche2, rewardPerTranche)).to.be.revertedWith(
					"VoSpoolRewards::updateVoSpoolRewardRate: Cannot set rewards for finished tranches"
				);
			});
		});

		describe("Test endVoSpoolReward", () => {
			it("Should end rewards for next tranche index", async () => {
				// ARRANGE
				const rewardPerTranche = parseUnits("1000");
				const toTranche = 5;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await increaseOneWeek();

				// ACT
				await voSpoolRewards.endVoSpoolReward();

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(1);
				expect(config.hasRewards).to.be.equal(false);
				expect(config.lastSetRewardTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());

				const voSpoolRewardRates = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates.one.fromTranche).to.be.equal(1);
				expect(voSpoolRewardRates.one.toTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());
				expect(voSpoolRewardRates.one.rewardPerTranche).to.be.equal(rewardPerTranche);
			});

			it("End rewards for same tranche index as added, should reset the configuration", async () => {
				// ARRANGE
				const rewardPerTranche = parseUnits("1000");
				const toTranche = 5;
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);

				// ACT
				await voSpoolRewards.endVoSpoolReward();

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(0);
				expect(config.hasRewards).to.be.equal(false);
				expect(config.lastSetRewardTranche).to.be.equal(0);

				const voSpoolRewardRates = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates.one.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates.one.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates.one.rewardPerTranche).to.be.equal(0);
			});

			it("Add rewards twice and end rewards, should keep both rewards with last one finishing at current index", async () => {
				// ARRANGE
				const rewardPerTranche1 = parseUnits("1000");
				const rewardPerTranche2 = parseUnits("1000");
				const toTranche1 = 5;
				const toTranche2 = 6;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche1, rewardPerTranche1);
				await increaseOneWeek();
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche2, rewardPerTranche2);
				await increaseOneWeek();

				// ACT
				await voSpoolRewards.endVoSpoolReward();

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(2);
				expect(config.hasRewards).to.be.equal(false);
				expect(config.lastSetRewardTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());

				const voSpoolRewardRates0 = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates0.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates0.one.fromTranche).to.be.equal(1);
				expect(voSpoolRewardRates0.one.toTranche).to.be.equal(2);
				expect(voSpoolRewardRates0.one.rewardPerTranche).to.be.equal(rewardPerTranche1);

				const voSpoolRewardRates1 = await voSpoolRewards.voSpoolRewardRates(1);

				expect(voSpoolRewardRates1.zero.fromTranche).to.be.equal(2);
				expect(voSpoolRewardRates1.zero.toTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());
				expect(voSpoolRewardRates1.zero.rewardPerTranche).to.be.equal(rewardPerTranche2);
			});

			it("Add rewards twice and end rewards same index as second reward started, should remove last added reward", async () => {
				// ARRANGE
				const rewardPerTranche1 = parseUnits("1000");
				const rewardPerTranche2 = parseUnits("1000");
				const toTranche1 = 5;
				const toTranche2 = 6;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche1, rewardPerTranche1);
				await increaseOneWeek();
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche2, rewardPerTranche2);

				// ACT
				await voSpoolRewards.endVoSpoolReward();

				// ASSERT
				const config = await voSpoolRewards.voSpoolRewardConfig();
				expect(config.rewardRatesIndex).to.be.equal(1);
				expect(config.hasRewards).to.be.equal(false);
				expect(config.lastSetRewardTranche).to.be.equal(await voSpool.getCurrentTrancheIndex());

				const voSpoolRewardRates0 = await voSpoolRewards.voSpoolRewardRates(0);
				expect(voSpoolRewardRates0.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates0.zero.rewardPerTranche).to.be.equal(0);

				expect(voSpoolRewardRates0.one.fromTranche).to.be.equal(1);
				expect(voSpoolRewardRates0.one.toTranche).to.be.equal(2);
				expect(voSpoolRewardRates0.one.rewardPerTranche).to.be.equal(rewardPerTranche1);

				const voSpoolRewardRates1 = await voSpoolRewards.voSpoolRewardRates(1);
				expect(voSpoolRewardRates1.zero.fromTranche).to.be.equal(0);
				expect(voSpoolRewardRates1.zero.toTranche).to.be.equal(0);
				expect(voSpoolRewardRates1.zero.rewardPerTranche).to.be.equal(0);
			});

			it("End reward before adding, should revert", async () => {
				// ACT / ASSERT
				await expect(voSpoolRewards.endVoSpoolReward()).to.be.revertedWith(
					"VoSpoolRewards::endVoSpoolReward: No rewards configured"
				);
			});

			it("End reward after finished, should revert", async () => {
				// ARRANGE
				const rewardPerTranche = parseUnits("1000");

				await voSpoolRewards.updateVoSpoolRewardRate(2, rewardPerTranche);
				await increaseOneWeek();

				// ACT / ASSERT
				await expect(voSpoolRewards.endVoSpoolReward()).to.be.revertedWith(
					"VoSpoolRewards::endVoSpoolReward: Rewards already ended"
				);
			});
		});

		describe("Test Spool DAO restricted", () => {
			it("Update reward as user, should revert", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				// ACT / ASSERT
				await expect(voSpoolRewards.connect(user1).updateVoSpoolRewardRate(10, 10)).to.be.revertedWith(
					"SpoolOwnable::onlyOwner: Caller is not the Spool owner"
				);
			});

			it("End reward as user, should revert", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				// ACT / ASSERT
				await expect(voSpoolRewards.connect(user1).endVoSpoolReward()).to.be.revertedWith(
					"SpoolOwnable::onlyOwner: Caller is not the Spool owner"
				);
			});
		});
	});

	describe("Reward updates", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;
		let voSpoolRewards: VoSpoolRewards;

		before("Deploy SpoolOwner contract", async () => {
			const { owner } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
		});

		beforeEach("Deploy contracts and set minter", async () => {
			const { deployer, spoolStaking, owner, gradualMinter } = await getSigners();
			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());
			voSpoolRewards = await new VoSpoolRewards__factory()
				.connect(deployer)
				.deploy(spoolStaking.address, voSpool.address, spoolOwner.address);

			await voSpool.connect(owner).setGradualMinter(gradualMinter.address, true);

			voSpool = voSpool.connect(gradualMinter);
			voSpoolRewards = voSpoolRewards.connect(spoolStaking);
		});

		describe("Test updateRewards", () => {
			it("Add new reward configuration and update", async () => {
				// ARRANGE
				const { owner, user1 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);

				// ACT
				await voSpoolRewards.updateRewards(user1.address);

				// ASSERT
				const rewards = await voSpoolRewards.userRewards(user1.address);
				expect(rewards.lastRewardRateIndex).to.be.equal(1);
				expect(rewards.earned).to.be.equal(0);

				expect(await voSpoolRewards.getTranchePower(1)).to.be.equal(0);
			});

			it("Mint for one user, add rewards and wait a week, user should get rewards in size of set reward rate", async () => {
				// ARRANGE
				const { owner, user1 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const mintAmount = parseUnits("1000");
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.mintGradual(user1.address, mintAmount);

				// ACT
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);

				// ASSERT
				const rewards = await voSpoolRewards.userRewards(user1.address);
				expect(rewards.lastRewardRateIndex).to.be.equal(1);
				expect(rewards.earned).to.be.equal(rewardPerTranche);

				expect(await voSpoolRewards.getTranchePower(0)).to.be.equal(0);
				expect(await voSpoolRewards.getTranchePower(1)).to.be.equal(
					trim(await voSpool.getTotalGradualVotingPower())
				);
			});

			it("Mint for one user, add rewards and wait a week, update twice, user should get rewards in size of set reward rate", async () => {
				// ARRANGE
				const { owner, user1 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const mintAmount = parseUnits("1000");
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.mintGradual(user1.address, mintAmount);

				// ACT
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await voSpoolRewards.updateRewards(user1.address);

				// ASSERT
				const rewards = await voSpoolRewards.userRewards(user1.address);
				expect(rewards.lastRewardRateIndex).to.be.equal(1);
				expect(rewards.earned).to.be.equal(rewardPerTranche);

				expect(await voSpoolRewards.getTranchePower(0)).to.be.equal(0);
				expect(await voSpoolRewards.getTranchePower(1)).to.be.equal(
					trim(await voSpool.getTotalGradualVotingPower())
				);
			});

			it("Mint for one user, add rewards and wait few week, user should get rewards in size of set reward rate", async () => {
				// ARRANGE
				const { owner, user1 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const mintAmount = parseUnits("1000");
				const startTranche = await voSpool.getCurrentTrancheIndex();
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.mintGradual(user1.address, mintAmount);

				// ACT
				await increaseWeeks(7);
				await voSpoolRewards.updateRewards(user1.address);

				// ASSERT
				const tranchesPassed = toTranche - startTranche;
				const rewards = await voSpoolRewards.userRewards(user1.address);
				expect(rewards.lastRewardRateIndex).to.be.equal(1);
				expect(rewards.earned).to.be.equal(rewardPerTranche.mul(tranchesPassed));

				const powerWeek1 = trim(getVotingPowerForWeeksPassed(mintAmount, 1));
				const powerWeek2 = trim(getVotingPowerForWeeksPassed(mintAmount, 2));
				const powerWeek3 = trim(getVotingPowerForWeeksPassed(mintAmount, 3));
				const powerWeek4 = trim(getVotingPowerForWeeksPassed(mintAmount, 4));
				const powerWeek5 = trim(getVotingPowerForWeeksPassed(mintAmount, 5));

				expect(await voSpoolRewards.getTranchePower(0)).to.be.equal(0);
				expect(await voSpoolRewards.getTranchePower(1)).to.be.equal(powerWeek1);
				expect(await voSpoolRewards.getTranchePower(2)).to.be.equal(powerWeek2);
				expect(await voSpoolRewards.getTranchePower(3)).to.be.equal(powerWeek3);
				expect(await voSpoolRewards.getTranchePower(4)).to.be.equal(powerWeek4);
				expect(await voSpoolRewards.getTranchePower(5)).to.be.equal(powerWeek5);
				expect(await voSpoolRewards.getTranchePower(6)).to.be.equal(0);
				expect(await voSpoolRewards.getTranchePower(7)).to.be.equal(0);
			});

			it("Mint for two users, add rewards and wait a few weeks, users should get rewards proportionally to their gradual voting power", async () => {
				// ARRANGE
				const { owner, user1, user2 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const mintAmount1 = parseUnits("400");
				const mintAmount2 = parseUnits("600");
				const mintAmountTotal = mintAmount1.add(mintAmount2);
				const startTranche = await voSpool.getCurrentTrancheIndex();
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpoolRewards.updateRewards(user2.address);
				await voSpool.mintGradual(user1.address, mintAmount1);
				await voSpool.mintGradual(user2.address, mintAmount2);

				// ACT
				await increaseWeeks(7);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpoolRewards.updateRewards(user2.address);

				// ASSERT
				const tranchesPassed = toTranche - startTranche;
				const totalEmissions = rewardPerTranche.mul(tranchesPassed);

				// user 1
				const user1rewards = await voSpoolRewards.userRewards(user1.address);
				expect(user1rewards.lastRewardRateIndex).to.be.equal(1);
				expect(user1rewards.earned).to.beCloseTo(
					totalEmissions.mul(mintAmount1).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// user 2
				const user2rewards = await voSpoolRewards.userRewards(user2.address);
				expect(user2rewards.lastRewardRateIndex).to.be.equal(1);
				expect(user2rewards.earned).beCloseTo(
					totalEmissions.mul(mintAmount2).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// global values
				const powerWeek1 = trim(getVotingPowerForWeeksPassed(mintAmountTotal, 1));
				const powerWeek2 = trim(getVotingPowerForWeeksPassed(mintAmountTotal, 2));
				const powerWeek3 = trim(getVotingPowerForWeeksPassed(mintAmountTotal, 3));
				const powerWeek4 = trim(getVotingPowerForWeeksPassed(mintAmountTotal, 4));
				const powerWeek5 = trim(getVotingPowerForWeeksPassed(mintAmountTotal, 5));

				expect(await voSpoolRewards.getTranchePower(0)).to.be.equal(0);
				expect(await voSpoolRewards.getTranchePower(1)).to.be.equal(powerWeek1);
				expect(await voSpoolRewards.getTranchePower(2)).to.be.equal(powerWeek2);
				expect(await voSpoolRewards.getTranchePower(3)).to.be.equal(powerWeek3);
				expect(await voSpoolRewards.getTranchePower(4)).to.be.equal(powerWeek4);
				expect(await voSpoolRewards.getTranchePower(5)).to.be.equal(powerWeek5);
				expect(await voSpoolRewards.getTranchePower(6)).to.be.equal(0);
			});

			it("Mint for two users, add rewards and wait a few weeks while updating user 1 every week, users should get rewards proportionally to their gradual power", async () => {
				// ARRANGE
				const { owner, user1, user2 } = await getSigners();
				const rewardPerTranche = parseUnits("10");
				const mintAmount1 = parseUnits("400");
				const mintAmount2 = parseUnits("600");
				const mintAmountTotal = mintAmount1.add(mintAmount2);
				const startTranche = await voSpool.getCurrentTrancheIndex();
				const toTranche = 5;
				await voSpoolRewards.connect(owner).updateVoSpoolRewardRate(toTranche, rewardPerTranche);
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.mintGradual(user1.address, mintAmount1);
				await voSpoolRewards.updateRewards(user2.address);
				await voSpool.mintGradual(user2.address, mintAmount2);

				// ACT
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await increaseOneWeek();
				await voSpoolRewards.updateRewards(user2.address);
				await voSpool.updateUserVotingPower(user2.address);

				// ASSERT
				const tranchesPassed = toTranche - startTranche;
				const totalEmissions = rewardPerTranche.mul(tranchesPassed);

				// user 1
				const user1rewards = await voSpoolRewards.userRewards(user1.address);
				expect(user1rewards.lastRewardRateIndex).to.be.equal(1);
				expect(user1rewards.earned).to.beCloseTo(
					totalEmissions.mul(mintAmount1).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// user 2
				const user2rewards = await voSpoolRewards.userRewards(user2.address);
				expect(user2rewards.lastRewardRateIndex).to.be.equal(1);
				expect(user2rewards.earned).to.beCloseTo(
					totalEmissions.mul(mintAmount2).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// global values
				// range from 0 to including 5
				for (const i of [...Array(6).keys()]) {
					const powerWeek = trim(getVotingPowerForWeeksPassed(mintAmountTotal, i));
					expect(await voSpoolRewards.getTranchePower(i)).to.be.equal(powerWeek);
				}
				expect(await voSpoolRewards.getTranchePower(6)).to.be.equal(0);
			});

			it("Mint for two users, update reward rate for tranches, users should rewards proportionally to their gradual power", async () => {
				// ARRANGE
				const { owner, user1, user2 } = await getSigners();
				const rewardPerTranche1 = parseUnits("10");
				const rpt1length = 3;
				const rewardPerTranche2 = parseUnits("20");
				const rpt2length = 2;
				const rewardPerTranche3 = parseUnits("30");
				const rpt3length = 3;
				const rewardPerTranche4 = parseUnits("40");
				const rpt4length = 4;

				const mintAmount1 = parseUnits("400");
				const mintAmount2 = parseUnits("600");
				const mintAmountTotal = mintAmount1.add(mintAmount2);

				// ACT
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.mintGradual(user1.address, mintAmount1);
				await voSpoolRewards.updateRewards(user2.address);
				await voSpool.mintGradual(user2.address, mintAmount2);

				let trancheIndex = 1;
				await voSpoolRewards
					.connect(owner)
					.updateVoSpoolRewardRate(trancheIndex + rpt1length, rewardPerTranche1);
				await increaseWeeks(rpt1length);
				trancheIndex += rpt1length;
				await voSpoolRewards
					.connect(owner)
					.updateVoSpoolRewardRate(trancheIndex + rpt2length, rewardPerTranche2);
				await increaseWeeks(5);

				// we wait for rewards to reach toTranche and stop inbetween
				trancheIndex += 5;

				await voSpoolRewards
					.connect(owner)
					.updateVoSpoolRewardRate(trancheIndex + rpt3length, rewardPerTranche3);
				await increaseWeeks(rpt3length);
				trancheIndex += rpt3length;
				await voSpoolRewards
					.connect(owner)
					.updateVoSpoolRewardRate(trancheIndex + rpt4length, rewardPerTranche4);
				await increaseWeeks(rpt4length);
				trancheIndex += rpt4length;

				// ASSERT

				// pass few more weeks
				await increaseWeeks(5);

				// update users after
				await voSpoolRewards.updateRewards(user1.address);
				await voSpool.updateUserVotingPower(user1.address);
				await voSpoolRewards.updateRewards(user2.address);
				await voSpool.updateUserVotingPower(user2.address);

				const totalEmissions = rewardPerTranche1
					.mul(3)
					.add(rewardPerTranche2.mul(2))
					.add(rewardPerTranche3.mul(3))
					.add(rewardPerTranche4.mul(4));

				// user 1
				const user1rewards = await voSpoolRewards.userRewards(user1.address);
				expect(user1rewards.lastRewardRateIndex).to.be.equal(4);
				expect(user1rewards.earned).to.beCloseTo(
					totalEmissions.mul(mintAmount1).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// user 2
				const user2rewards = await voSpoolRewards.userRewards(user2.address);
				expect(user2rewards.lastRewardRateIndex).to.be.equal(4);
				expect(user2rewards.earned).to.beCloseTo(
					totalEmissions.mul(mintAmount2).div(mintAmountTotal),
					BasisPoints.Basis_1
				);

				// global values

				// range from 0 to including trancheIndex
				for (const i of [...Array(trancheIndex + 1).keys()]) {
					const powerWeek = trim(getVotingPowerForWeeksPassed(mintAmountTotal, i));
					expect(await voSpoolRewards.getTranchePower(i)).to.be.equal(powerWeek);
				}

				expect(await voSpoolRewards.getTranchePower(trancheIndex + 1)).to.be.equal(0);
			});
		});

		describe("Test Spool staking restricted", () => {
			it("Update rewards as user, should revert", async () => {
				// ARRANGE
				const { user1, user2 } = await getSigners();

				// ACT / ASSERT
				await expect(voSpoolRewards.connect(user1).updateRewards(user2.address)).to.be.revertedWith(
					"VoSpoolRewards::_onlySpoolStaking: Insufficient Privileges"
				);
			});
		});
	});
});
