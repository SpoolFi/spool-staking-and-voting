import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import {
	RewardDistributor,
	RewardDistributor__factory,
	SpoolOwner__factory,
	MockToken__factory,
	MockToken,
	SpoolStaking__factory,
	VoSPOOL__factory,
	VoSpoolRewards__factory,
	SpoolStaking,
	SpoolOwner,
	VoSPOOL,
	VoSpoolRewards,
} from "../build/types";
import { BasisPoints } from "./shared/chaiExtension/chaiExtAssertions";

import {
	increaseWeeks,
	increaseOneWeek,
	getVotingPowerForWeeksPassed,
	trim,
	getChainTimeInTwoDays,
	getFutureContractAddress,
	SECS_DAY,
} from "./shared/utilities";

use(solidity);

const { parseUnits } = ethers.utils;

async function getSigners() {
	const [deployer, owner, pauser, stakeForWallet, stakeForWallet2, user1, user2] = await ethers.getSigners();

	return {
		deployer,
		owner,
		pauser,
		stakeForWallet,
		stakeForWallet2,
		user1,
		user2,
	};
}

describe("SpoolStaking tests", () => {
	let stakingToken: MockToken;
	let rewardToken1: MockToken;
	let rewardToken2: MockToken;

	before("Deploy mock token contracts", async () => {
		const { deployer } = await getSigners();
		stakingToken = await new MockToken__factory().connect(deployer).deploy("SPOOL", "SPOOL");
		rewardToken1 = await new MockToken__factory().connect(deployer).deploy("TEST", "TEST");
		rewardToken2 = await new MockToken__factory().connect(deployer).deploy("TEST", "TEST");
	});

	describe("SpoolStaking Deployment", () => {
		it("Should deploy the SpoolStaking contract", async () => {
			// ARRANGE
			const { deployer, owner } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			const voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());

			const rewardDistributor = await new RewardDistributor__factory()
				.connect(deployer)
				.deploy(spoolOwner.address);

			const spoolStakingAddress = await getFutureContractAddress(deployer, 1);

			const voSpoolRewards = await new VoSpoolRewards__factory()
				.connect(deployer)
				.deploy(spoolStakingAddress, voSpool.address, spoolOwner.address);

			// ACT
			const spoolStaking = await new SpoolStaking__factory()
				.connect(deployer)
				.deploy(
					stakingToken.address,
					voSpool.address,
					voSpoolRewards.address,
					rewardDistributor.address,
					spoolOwner.address
				);

			await spoolStaking.initialize();

			// ASSERT
			expect(spoolStaking.address).to.be.equal(spoolStakingAddress);
		});
	});

	describe("Staking", () => {
		let spoolOwner: SpoolOwner;
		let voSpool: VoSPOOL;
		let voSpoolRewards: VoSpoolRewards;
		let rewardDistributor: RewardDistributor;
		let spoolStaking: SpoolStaking;

		before("Deploy SpoolOwner contract", async () => {
			const { owner, stakeForWallet, stakeForWallet2, user1, user2 } = await getSigners();
			spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();

			stakingToken.mint(owner.address, parseUnits("100000000"));
			stakingToken.mint(user1.address, parseUnits("100000000"));
			stakingToken.mint(user2.address, parseUnits("100000000"));
			stakingToken.mint(stakeForWallet.address, parseUnits("100000000"));
			stakingToken.mint(stakeForWallet2.address, parseUnits("100000000"));
		});

		beforeEach("Deploy contracts, initialize, setup, approve, and send reward token", async () => {
			const { deployer, owner, pauser, stakeForWallet, stakeForWallet2, user1, user2 } = await getSigners();

			voSpool = await new VoSPOOL__factory()
				.connect(deployer)
				.deploy(spoolOwner.address, await getChainTimeInTwoDays());

			rewardDistributor = await new RewardDistributor__factory().connect(deployer).deploy(spoolOwner.address);

			const spoolStakingAddress = await getFutureContractAddress(deployer, 1);

			voSpoolRewards = await new VoSpoolRewards__factory()
				.connect(deployer)
				.deploy(spoolStakingAddress, voSpool.address, spoolOwner.address);

			// ACT
			spoolStaking = await new SpoolStaking__factory()
				.connect(deployer)
				.deploy(
					stakingToken.address,
					voSpool.address,
					voSpoolRewards.address,
					rewardDistributor.address,
					spoolOwner.address
				);

			await spoolStaking.initialize();

			spoolStaking = spoolStaking.connect(owner);
			voSpoolRewards = voSpoolRewards.connect(owner);
			rewardDistributor = rewardDistributor.connect(owner);
			voSpool = voSpool.connect(owner);

			await rewardDistributor.setPauser(pauser.address, true);
			await rewardDistributor.setDistributor(spoolStaking.address, true);
			await voSpool.setGradualMinter(spoolStaking.address, true);
			await spoolStaking.setCanStakeFor(stakeForWallet.address, true);
			await spoolStaking.setCanStakeFor(stakeForWallet2.address, true);

			stakingToken.connect(owner).approve(spoolStaking.address, ethers.constants.MaxUint256);
			stakingToken.connect(user1).approve(spoolStaking.address, ethers.constants.MaxUint256);
			stakingToken.connect(user2).approve(spoolStaking.address, ethers.constants.MaxUint256);
			stakingToken.connect(stakeForWallet).approve(spoolStaking.address, ethers.constants.MaxUint256);
			stakingToken.connect(stakeForWallet2).approve(spoolStaking.address, ethers.constants.MaxUint256);

			rewardToken1.transfer(rewardDistributor.address, parseUnits("100000"));
			rewardToken2.transfer(rewardDistributor.address, parseUnits("100000"));
			stakingToken.transfer(rewardDistributor.address, parseUnits("100000"));
		});

		describe("Reward Configuration", () => {
			it("Should add one token", async () => {
				// ARRANGE
				const rewardAmount = parseUnits("10000");
				const rewardDuration = SECS_DAY * 10; // 10 days

				// ACT
				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				// ASSERT
				expect(await spoolStaking.rewardTokensCount()).to.equal(1);
				expect(await spoolStaking.rewardTokens(0)).to.equal(rewardToken1.address);

				const rewardConfiguration = await spoolStaking.rewardConfiguration(rewardToken1.address);
				expect(rewardConfiguration.rewardsDuration).to.equal(rewardDuration);
				const rewardRatePredicted = rewardAmount.mul(BigNumber.from(10).pow(18)).div(rewardDuration);
				expect(rewardConfiguration.rewardRate).to.beCloseTo(rewardRatePredicted, BasisPoints.Basis_1);
			});

			it("Should add two tokens", async () => {
				// ARRANGE
				const rewardAmount = parseUnits("10000");
				const rewardDuration = SECS_DAY * 10; // 10 days

				// ACT
				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);
				await spoolStaking.addToken(rewardToken2.address, rewardDuration, rewardAmount);

				// ASSERT
				expect(await spoolStaking.rewardTokensCount()).to.equal(2);
				expect(await spoolStaking.rewardTokens(0)).to.equal(rewardToken1.address);
				expect(await spoolStaking.rewardTokens(1)).to.equal(rewardToken2.address);
			});
		});

		describe("stake()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche: BigNumber;
			let toTranche: number;

			beforeEach("Add reward token 1 and voSPOOL reward", async () => {
				const { user1 } = await getSigners();

				rewardAmount = parseUnits("10000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				spoolStaking = spoolStaking.connect(user1);

				// add voSPOOL reward
				rewardPerTranche = parseUnits("1000");
				toTranche = 15;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Should stake", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				const stakeAmount = parseUnits("1000");
				const balanceBefore = await stakingToken.balanceOf(user1.address);

				// ACT
				await spoolStaking.stake(stakeAmount);

				// ASSERT
				const balanceAfter = await stakingToken.balanceOf(user1.address);
				const user1balanceDiff = balanceBefore.sub(balanceAfter);
				expect(user1balanceDiff).to.be.equal(stakeAmount);
				expect(await spoolStaking.balances(user1.address)).to.be.equal(stakeAmount);

				// verify voSPOOL
				const userAmount = trim(stakeAmount);
				// user gradual
				const userGradual = await voSpool.getUserGradual(user1.address);
				expect(userGradual.maturingAmount).to.be.equal(userAmount);

				// voSPOOL after one week
				await increaseOneWeek();
				const expectedMaturedAmount = getVotingPowerForWeeksPassed(stakeAmount, 1);
				const voSpoolBalance = await voSpool.balanceOf(user1.address);
				expect(voSpoolBalance).to.be.equal(expectedMaturedAmount);
			});

			it("Stake and wait, should recieve voSPOOL after a week", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				const stakeAmount = parseUnits("1000");

				// ACT
				await spoolStaking.stake(stakeAmount);
				await increaseOneWeek();

				// ASSERT
				// reward 1
				const earnedReward1 = await spoolStaking.earned(rewardToken1.address, user1.address);
				expect(earnedReward1).to.beCloseTo(
					rewardAmount.mul(7 * SECS_DAY).div(rewardDuration),
					BasisPoints.Basis_1
				);

				// SPOOL reward from voSPOOL
				const voRewardsEarned = await spoolStaking.callStatic.getUpdatedVoSpoolRewardAmount();
				expect(voRewardsEarned).to.be.equal(rewardPerTranche);
			});
		});

		describe("compound()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche: BigNumber;
			let toTranche: number;

			beforeEach("Add SPOOL reward token 1 and voSPOOL reward", async () => {
				const { user1 } = await getSigners();

				rewardAmount = parseUnits("10000");
				rewardDuration = SECS_DAY * 10; // 30 days

				await spoolStaking.addToken(stakingToken.address, rewardDuration, rewardAmount);

				spoolStaking = spoolStaking.connect(user1);

				// add voSPOOL reward
				rewardPerTranche = parseUnits("1000");
				toTranche = 3;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Should compound SPOOL from SPOOL rewards and voSPOOL rewards", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				const stakeAmount = parseUnits("100");
				const balanceBefore = await stakingToken.balanceOf(user1.address);
				await spoolStaking.stake(stakeAmount);
				// wait for both rewards to pass
				await increaseWeeks(4);

				const spoolEarned = await spoolStaking.earned(stakingToken.address, user1.address);
				expect(spoolEarned).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
				const voSpoolEarned = await spoolStaking.callStatic.getUpdatedVoSpoolRewardAmount();
				expect(rewardPerTranche.mul(2)).to.be.beCloseTo(voSpoolEarned, BasisPoints.Basis_1);

				// ACT
				await spoolStaking.compound(true);

				// ASSERT
				const compoundedAmount = spoolEarned.add(voSpoolEarned);
				const stakedPlusCompounded = stakeAmount.add(compoundedAmount);
				expect(await spoolStaking.balances(user1.address)).to.beCloseTo(
					stakedPlusCompounded,
					BasisPoints.Basis_1
				);

				// SPOOL reward from SPOOL
				expect(await spoolStaking.earned(stakingToken.address, user1.address)).to.be.equal(0);
				// SPOOL reward from voSPOOL
				const voRewardsEarned = await spoolStaking.callStatic.getUpdatedVoSpoolRewardAmount();
				expect(voRewardsEarned).to.be.equal(0);

				// ACT - unstake
				await spoolStaking.unstake(stakedPlusCompounded);

				// ASSERT
				const balanceAfter = await stakingToken.balanceOf(user1.address);
				expect(balanceAfter.sub(balanceBefore)).to.be.equal(compoundedAmount);
			});
		});

		describe("stakeFor()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche = parseUnits("1000");
			let toTranche = 15;

			beforeEach("Add reward token 1 and voSPOOL reward", async () => {
				const { stakeForWallet } = await getSigners();

				rewardAmount = parseUnits("10000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				// set stake for wallet as defauld address
				spoolStaking = spoolStaking.connect(stakeForWallet);

				// add voSPOOL reward
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Should stake for user", async () => {
				// ARRANGE
				const { user1, stakeForWallet } = await getSigners();

				const stakeAmount = parseUnits("1000");
				const balanceBefore = await stakingToken.balanceOf(stakeForWallet.address);

				// ACT
				await spoolStaking.stakeFor(user1.address, stakeAmount);

				// ASSERT
				expect(await spoolStaking.stakedBy(user1.address)).to.be.equal(stakeForWallet.address);

				const balanceAfter = await stakingToken.balanceOf(stakeForWallet.address);
				const user1balanceDiff = balanceBefore.sub(balanceAfter);
				expect(user1balanceDiff).to.be.equal(stakeAmount);
				expect(await spoolStaking.balances(user1.address)).to.be.equal(stakeAmount);

				// verify voSPOOL
				const userAmount = trim(stakeAmount);
				// user gradual
				const userGradual = await voSpool.getUserGradual(user1.address);
				expect(userGradual.maturingAmount).to.be.equal(userAmount);

				// voSPOOL after one week
				await increaseOneWeek();
				const expectedMaturedAmount = getVotingPowerForWeeksPassed(stakeAmount, 1);
				const voSpoolBalance = await voSpool.balanceOf(user1.address);
				expect(voSpoolBalance).to.be.equal(expectedMaturedAmount);
			});

			it("Stake for as owner user and wait, should recieve voSPOOL after a week", async () => {
				// ARRANGE
				const { user1, owner } = await getSigners();

				const stakeAmount = parseUnits("1000");

				// ACT
				await spoolStaking.connect(owner).stakeFor(user1.address, stakeAmount);
				await increaseOneWeek();

				// ASSERT
				expect(await spoolStaking.stakedBy(user1.address)).to.be.equal(owner.address);

				// reward 1
				const earnedReward1 = await spoolStaking.earned(rewardToken1.address, user1.address);
				expect(earnedReward1).to.beCloseTo(
					rewardAmount.mul(7 * SECS_DAY).div(rewardDuration),
					BasisPoints.Basis_1
				);

				// SPOOL reward from voSPOOL
				const voRewardsEarned = await spoolStaking.connect(user1).callStatic.getUpdatedVoSpoolRewardAmount();
				expect(voRewardsEarned).to.be.equal(rewardPerTranche);
			});

			it("Stake for by user, should revert", async () => {
				// ARRANGE
				const { user1, user2 } = await getSigners();

				await expect(
					spoolStaking.connect(user1).stakeFor(user2.address, parseUnits("1000"))
				).to.be.revertedWith("SpoolStaking::canStakeForAddress: Cannot stake for other addresses");
			});

			it("Stake for after user stake, should revert", async () => {
				// ARRANGE
				const { user1, user2 } = await getSigners();
				await spoolStaking.connect(user1).stake(parseUnits("1000"));

				await expect(spoolStaking.stakeFor(user1.address, parseUnits("1000"))).to.be.revertedWith(
					"SpoolStaking::canStakeForAddress: Address already staked"
				);
			});

			it("Stake for after stake for by another address, should revert", async () => {
				// ARRANGE
				const { user1, stakeForWallet2 } = await getSigners();
				await spoolStaking.stakeFor(user1.address, parseUnits("1000"));

				await expect(
					spoolStaking.connect(stakeForWallet2).stakeFor(user1.address, parseUnits("1000"))
				).to.be.revertedWith("SpoolStaking::canStakeForAddress: Address staked by another address");
			});

			it("Stake for as owner after stake for by another address, should pass", async () => {
				// ARRANGE
				const { user1, owner } = await getSigners();
				await spoolStaking.stakeFor(user1.address, parseUnits("1000"));

				await spoolStaking.connect(owner).stakeFor(user1.address, parseUnits("1000"));
			});
		});

		describe("allowUnstakeFor()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche = parseUnits("1000");
			let toTranche = 15;

			beforeEach("Add reward token 1 and voSPOOL reward", async () => {
				const { stakeForWallet } = await getSigners();

				rewardAmount = parseUnits("100000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				// set stake for wallet as defauld address
				spoolStaking = spoolStaking.connect(stakeForWallet);

				// add voSPOOL reward
				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Should allow unstaking, after stake for user", async () => {
				// ARRANGE
				const { user1, stakeForWallet } = await getSigners();

				const stakeAmount = parseUnits("1000");
				await spoolStaking.stakeFor(user1.address, stakeAmount);

				// ACT
				await spoolStaking.allowUnstakeFor(user1.address);

				// ASSERT
				expect(await spoolStaking.stakedBy(user1.address)).to.be.equal(ethers.constants.AddressZero);
				await spoolStaking.connect(user1).unstake(stakeAmount);
			});

			it("Should allow unstaking from Spool DAO, after stake for user", async () => {
				// ARRANGE
				const { user1, owner } = await getSigners();

				const stakeAmount = parseUnits("1000");
				await spoolStaking.stakeFor(user1.address, stakeAmount);

				// ACT
				await spoolStaking.connect(owner).allowUnstakeFor(user1.address);

				// ASSERT
				expect(await spoolStaking.stakedBy(user1.address)).to.be.equal(ethers.constants.AddressZero);
				await spoolStaking.connect(user1).unstake(stakeAmount);
			});

			it("Allow unstake for called by user 1, should revert", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				await spoolStaking.stakeFor(user1.address, parseUnits("1000"));

				await expect(spoolStaking.connect(user1).allowUnstakeFor(user1.address)).to.be.revertedWith(
					"SpoolStaking::allowUnstakeFor: Cannot allow unstaking for address"
				);
			});

			it("Allow unstake for called by different stake for wallet than stake for, should revert", async () => {
				// ARRANGE
				const { user1, stakeForWallet2 } = await getSigners();

				await spoolStaking.stakeFor(user1.address, parseUnits("1000"));

				await expect(spoolStaking.connect(stakeForWallet2).allowUnstakeFor(user1.address)).to.be.revertedWith(
					"SpoolStaking::allowUnstakeFor: Cannot allow unstaking for address"
				);
			});

			it("Stake for as owner after stake for by another address, should pass", async () => {
				// ARRANGE
				const { user1, owner } = await getSigners();
				await spoolStaking.stakeFor(user1.address, parseUnits("1000"));

				await spoolStaking.connect(owner).allowUnstakeFor(user1.address);
			});
		});

		describe("getActiveRewards()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche: BigNumber;
			let toTranche: number;

			beforeEach("Add reward token 1 and voSPOOL reward", async () => {
				const { user1 } = await getSigners();

				rewardAmount = parseUnits("100000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				spoolStaking = spoolStaking.connect(user1);

				// add voSPOOL reward
				rewardPerTranche = parseUnits("1000");
				toTranche = 15;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Stake and claim rewards after 5 weeks, should recieve reward tokens", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				const stakeAmount = parseUnits("1000");
				await spoolStaking.stake(stakeAmount);
				const spoolTokenBefore = await stakingToken.balanceOf(user1.address);
				const rewardTokenBefore = await rewardToken1.balanceOf(user1.address);

				await increaseWeeks(5);

				// ACT
				await spoolStaking.getActiveRewards(true);

				// ASSERT
				const spoolTokenAfter = await stakingToken.balanceOf(user1.address);
				const rewardTokenAfter = await rewardToken1.balanceOf(user1.address);

				expect(spoolTokenAfter.sub(spoolTokenBefore)).to.beCloseTo(
					rewardPerTranche.mul(5),
					BasisPoints.Basis_1
				);
				expect(rewardTokenAfter.sub(rewardTokenBefore)).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
			});
		});

		describe("unstake()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche: BigNumber;
			let toTranche: number;

			beforeEach("Add reward token 1 and voSPOOL reward", async () => {
				const { user1 } = await getSigners();

				rewardAmount = parseUnits("100000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);

				spoolStaking = spoolStaking.connect(user1);

				// add voSPOOL reward
				rewardPerTranche = parseUnits("1000");
				toTranche = 15;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Unstake after 5 weeks, should burn all voSPOOL", async () => {
				// ARRANGE
				const { user1 } = await getSigners();
				const spoolTokenBefore = await stakingToken.balanceOf(user1.address);
				const rewardTokenBefore = await rewardToken1.balanceOf(user1.address);

				const stakeAmount = parseUnits("1000");
				await spoolStaking.stake(stakeAmount);

				await increaseWeeks(5);

				const expectedMaturedAmount = getVotingPowerForWeeksPassed(stakeAmount, 5);
				expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmount);

				// ACT - unstake all
				await spoolStaking.unstake(stakeAmount);

				// ASSERT
				expect(await spoolStaking.balances(user1.address)).to.be.equal(0);
				// voSPOOL should go to 0
				expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);

				// ACT - claim rewards
				await spoolStaking.getActiveRewards(true);

				const spoolTokenAfter = await stakingToken.balanceOf(user1.address);
				const rewardTokenAfter = await rewardToken1.balanceOf(user1.address);

				expect(spoolTokenAfter.sub(spoolTokenBefore)).to.be.equal(rewardPerTranche.mul(5));
				expect(rewardTokenAfter.sub(rewardTokenBefore)).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
			});

			it("Partial unstake after 5 weeks, should burn all voSPOOL", async () => {
				// ARRANGE
				const { user1 } = await getSigners();

				const stakeAmount = parseUnits("1000");
				await spoolStaking.stake(stakeAmount);

				await increaseWeeks(5);

				const expectedMaturedAmountWeek1 = getVotingPowerForWeeksPassed(stakeAmount, 5);
				expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmountWeek1);

				// ACT
				const unstakeAmount = stakeAmount.div(2);
				await spoolStaking.unstake(unstakeAmount);

				// ASSERT
				expect(await spoolStaking.balances(user1.address)).to.be.equal(stakeAmount.sub(unstakeAmount));

				// voSPOOL should go to 0
				expect(await voSpool.balanceOf(user1.address)).to.be.equal(0);

				// ARRANGE - pass 1 week
				increaseOneWeek();

				const expectedMaturedAmountWeek1AfterBurn = getVotingPowerForWeeksPassed(
					stakeAmount.sub(unstakeAmount),
					1
				);
				// ASSERT
				expect(await voSpool.balanceOf(user1.address)).to.be.equal(expectedMaturedAmountWeek1AfterBurn);
			});
		});

		describe("removeReward()", () => {
			let rewardAmount: BigNumber;
			let rewardDuration: number;
			let rewardPerTranche: BigNumber;
			let toTranche: number;

			beforeEach("Add 3 reward tokens and a voSPOOL reward", async () => {
				const { user1 } = await getSigners();

				rewardAmount = parseUnits("100000");
				rewardDuration = SECS_DAY * 30; // 30 days

				await spoolStaking.addToken(rewardToken1.address, rewardDuration, rewardAmount);
				await spoolStaking.addToken(rewardToken2.address, rewardDuration, rewardAmount);
				await spoolStaking.addToken(stakingToken.address, rewardDuration, rewardAmount);

				spoolStaking = spoolStaking.connect(user1);

				// add voSPOOL reward
				rewardPerTranche = parseUnits("1000");
				toTranche = 15;

				await voSpoolRewards.updateVoSpoolRewardRate(toTranche, rewardPerTranche);
			});

			it("Remove reward after the reward is finished, all rewards should still be claimable in full amount", async () => {
				// ARRANGE
				const { owner, user1 } = await getSigners();

				await spoolStaking.stake(parseUnits("1000"));

				const rewardToken1Before = await rewardToken1.balanceOf(user1.address);
				const rewardToken2Before = await rewardToken1.balanceOf(user1.address);
				const spoolTokenBefore = await stakingToken.balanceOf(user1.address);

				expect(await spoolStaking.rewardTokensCount()).to.equal(3);

				await increaseWeeks(5);

				// ACT - remove token
				await spoolStaking.connect(owner).removeReward(rewardToken1.address);

				// ASSERT
				expect(await spoolStaking.rewardTokensCount()).to.equal(2);
				// stakingToken wasmoved from position 2 to 0 (swapped) with the removed token
				expect(await spoolStaking.rewardTokens(0)).to.equal(stakingToken.address);
				expect(await spoolStaking.rewardTokens(1)).to.equal(rewardToken2.address);

				await spoolStaking.getRewards(
					[rewardToken1.address, rewardToken2.address, stakingToken.address],
					false
				);

				const spoolTokenAfter = await stakingToken.balanceOf(user1.address);
				const rewardToken1After = await rewardToken1.balanceOf(user1.address);
				const rewardToken2After = await rewardToken1.balanceOf(user1.address);

				expect(rewardToken1After.sub(rewardToken1Before)).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
				expect(rewardToken2After.sub(rewardToken2Before)).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
				expect(spoolTokenAfter.sub(spoolTokenBefore)).to.beCloseTo(rewardAmount, BasisPoints.Basis_1);
			});

			it("End rewards early and remove reward", async () => {
				// ARRANGE
				const { owner } = await getSigners();

				await spoolStaking.stake(parseUnits("1000"));

				expect(await spoolStaking.rewardTokensCount()).to.equal(3);

				await increaseWeeks(1);

				// ACT - remove token
				const tx = await spoolStaking.connect(owner).updatePeriodFinish(rewardToken1.address, 0);
				await spoolStaking.connect(owner).removeReward(rewardToken1.address);

				// ASSERT
				expect(await spoolStaking.rewardTokensCount()).to.equal(2);
				// stakingToken was moved from position 2 to 0 (swapped) with the removed token
				expect(await spoolStaking.rewardTokens(0)).to.equal(stakingToken.address);
				expect(await spoolStaking.rewardTokens(1)).to.equal(rewardToken2.address);

				const txReceipt = await tx.wait();
				const block = await ethers.provider.getBlock(txReceipt.blockNumber);
				const rewardConfiguration = await spoolStaking.rewardConfiguration(rewardToken1.address);
				expect(rewardConfiguration.periodFinish).to.equal(block.timestamp);
			});
		});
	});
});
