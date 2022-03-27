import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import {
	RewardDistributor,
	RewardDistributor__factory,
	SpoolOwner__factory,
	MockToken__factory,
	MockToken,
} from "../build/types";

use(solidity);

const { parseUnits } = ethers.utils;

async function getSigners() {
	const [deployer, owner, spoolStaking, pauser, user1, user2] = await ethers.getSigners();

	return {
		deployer,
		owner,
		spoolStaking,
		pauser,
		user1,
		user2,
	};
}

describe("RewardDistributor tests", () => {
	describe("RewardDistributor Deployment", () => {
		it("Should deploy the RewardDistributor contract", async () => {
			// ARRANGE
			const { deployer, owner } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();

			// ACT
			const rewardDistributor = await new RewardDistributor__factory()
				.connect(deployer)
				.deploy(spoolOwner.address);

			// ASSERT
			expect(await rewardDistributor.paused()).to.be.equal(false);
		});
	});

	describe("Reward distributor functions", () => {
		let rewardToken1: MockToken;
		let rewardToken2: MockToken;
		let rewardDistributor: RewardDistributor;

		before("Deploy mock token contract", async () => {
			const { deployer } = await getSigners();
			rewardToken1 = await new MockToken__factory().connect(deployer).deploy("TEST1", "TEST1");
			rewardToken2 = await new MockToken__factory().connect(deployer).deploy("TEST2", "TEST2");
		});

		beforeEach("Deploy contracts and send reward token", async () => {
			const { deployer, owner, spoolStaking } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			rewardDistributor = await new RewardDistributor__factory().connect(deployer).deploy(spoolOwner.address);

			await rewardDistributor.connect(owner).setDistributor(spoolStaking.address, true);
			rewardDistributor = rewardDistributor.connect(spoolStaking);

			rewardToken1.transfer(rewardDistributor.address, parseUnits("10000"));
			rewardToken2.transfer(rewardDistributor.address, parseUnits("10000"));
		});

		it("Should pay token reward to a user", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const payAmount = parseUnits("10000");
			const balanceBefore = await rewardToken1.balanceOf(user1.address);

			// ACT
			await rewardDistributor.payReward(user1.address, rewardToken1.address, payAmount);

			// ASSERT
			const balanceAfter = await rewardToken1.balanceOf(user1.address);
			expect(balanceAfter.sub(balanceBefore)).to.be.equal(payAmount);
		});

		it("Should pay multiple token rewards to a user", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const payAmount1 = parseUnits("1000");
			const payAmount2 = parseUnits("2000");
			const balanceBefore1 = await rewardToken1.balanceOf(user1.address);
			const balanceBefore2 = await rewardToken2.balanceOf(user1.address);

			// ACT
			await rewardDistributor.payRewards(
				user1.address,
				[rewardToken1.address, rewardToken2.address],
				[payAmount1, payAmount2]
			);

			// ASSERT
			const balanceAfter1 = await rewardToken1.balanceOf(user1.address);
			const balanceAfter2 = await rewardToken2.balanceOf(user1.address);
			expect(balanceAfter1.sub(balanceBefore1)).to.be.equal(payAmount1);
			expect(balanceAfter2.sub(balanceBefore2)).to.be.equal(payAmount2);
		});

		it("Should pay token reward to a user", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			// ACT / ASSERT
			await expect(
				rewardDistributor.connect(user1).payReward(user1.address, rewardToken1.address, parseUnits("10000"))
			).to.be.revertedWith("RewardDistributor::_onlyDistributor: Not a distributor");
		});
	});

	describe("Spool DAO functions", () => {
		let rewardToken1: MockToken;
		let rewardDistributor: RewardDistributor;

		before("Deploy mock token contract", async () => {
			const { deployer } = await getSigners();
			rewardToken1 = await new MockToken__factory().connect(deployer).deploy("TEST1", "TEST1");
		});

		beforeEach("Deploy contracts and send reward token", async () => {
			const { deployer, owner, spoolStaking } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			rewardDistributor = await new RewardDistributor__factory().connect(deployer).deploy(spoolOwner.address);

			rewardDistributor = rewardDistributor.connect(owner);
			await rewardDistributor.setDistributor(spoolStaking.address, true);

			rewardToken1.transfer(rewardDistributor.address, parseUnits("10000"));
		});

		it("Should retrieve rewards, set wallet should recieve retrieved tokens", async () => {
			// ARRANGE
			const { user1 } = await getSigners();

			const balanceBefore = await rewardToken1.balanceOf(user1.address);
			const retrieveAmount = parseUnits("10000");

			// ACT
			await rewardDistributor.retrieveRewards(user1.address, rewardToken1.address, retrieveAmount);

			// ASSERT
			const balanceAfter = await rewardToken1.balanceOf(user1.address);
			expect(balanceAfter.sub(balanceBefore)).to.be.equal(retrieveAmount);
		});

		it("Unpause after pausing", async () => {
			// ACT / ASSERT
			await rewardDistributor.pause();
			expect(await rewardDistributor.paused()).to.be.true;

			await rewardDistributor.unpause();
			expect(await rewardDistributor.paused()).to.be.false;
		});
	});

	describe("Pause functions", () => {
		let rewardToken1: MockToken;
		let rewardDistributor: RewardDistributor;

		before("Deploy mock token contract", async () => {
			const { deployer } = await getSigners();
			rewardToken1 = await new MockToken__factory().connect(deployer).deploy("TEST1", "TEST1");
		});

		beforeEach("Deploy contracts and send reward token", async () => {
			const { deployer, owner, pauser, spoolStaking } = await getSigners();
			const spoolOwner = await new SpoolOwner__factory().connect(owner).deploy();
			rewardDistributor = await new RewardDistributor__factory().connect(deployer).deploy(spoolOwner.address);

			await rewardDistributor.connect(owner).setDistributor(spoolStaking.address, true);
			await rewardDistributor.connect(owner).setPauser(pauser.address, true);
			rewardDistributor = rewardDistributor.connect(pauser);

			rewardToken1.transfer(rewardDistributor.address, parseUnits("10000"));
		});

		it("Disable paying rewards when paused", async () => {
			// ARRANGE
			const { spoolStaking, user1 } = await getSigners();
			// ACT / ASSERT
			await rewardDistributor.pause();
			expect(await rewardDistributor.paused()).to.be.true;

			await expect(
				rewardDistributor.connect(spoolStaking).payReward(user1.address, rewardToken1.address, "100000")
			).to.be.revertedWith("Pausable: paused");
		});

		it("Unpause after pausing as pauser, should revert", async () => {
			// ARRANGE
			await rewardDistributor.pause();
			expect(await rewardDistributor.paused()).to.be.true;

			// ACT / ASSERT
			await expect(rewardDistributor.unpause()).to.be.revertedWith(
				"SpoolOwnable::onlyOwner: Caller is not the Spool owner"
			);
		});
	});
});
