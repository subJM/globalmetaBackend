const hre = require("hardhat");
async function main() {

  // const signers = await hre.ethers.getSigners();

  // for (const signer of signers) {
  //   console.log("Account:", signer.address);
  //   console.log("Balance:", (await signer.provider.getBalance(signer.address)).toString());
  // }

  //지갑주소
  // const [deployer] = await hre.ethers.getSigners();

  // console.log('deployer : ', deployer);
  // console.log("Deploying contracts with the account:", deployer.address);

  // sol파일 지정
  // const TestToken = await hre.ethers.getContractFactory("TestToken");
  // 계약 배포
  // const myContract = await TestToken.deploy(deployer.address);

  // console.log("MyContract address:", myContract);
  // deploy가 진행되는동안 기다리도록
  // await myContract.waitForDeployment();

  // console.log(
  //   //완료
  //   "완료",
  //   "Balance:", (await deployer.provider.getBalance(deployer.address)).toString()
  // );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
