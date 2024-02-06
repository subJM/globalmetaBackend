const hre = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("시작");
    const privateKey = fs.readFileSync('./user/thswhdals/privateKey', "utf8"); // 개인 키
    const address = fs.readFileSync('./user/thswhdals/address', "utf8");
    const provider = new hre.ethers.JsonRpcProvider(process.env.ALCHEMY_TESTNET_RPC_URL); // JSON RPC 프로바이더
    const wallet = new hre.ethers.Wallet(privateKey, provider); // 개인 키와 연결된 지갑 객체 생성
    
    const ContractFactory = await hre.ethers.getContractFactory("BBT2", wallet); // 지갑을 사용하여 계약 팩토리 생성
    const contract = await ContractFactory.deploy(address); // 계약 배포

    await contract.waitForDeployment();
    console.log("Contract deployed to:", contract.address);
    console.log("Contract target:", contract.target);
    
    return contract.target;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
