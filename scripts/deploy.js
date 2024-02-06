const hre = require("hardhat");
async function main() {
  console.log("시작");
  const [deployer] = await hre.ethers.getSigners();

  const TestToken = await hre.ethers.getContractFactory("TestToken");
  const myContract = await TestToken.deploy(deployer.address);

  await myContract.waitForDeployment();
  
  // console.dir(myContract.runner.address, { depth: null });
  // console.log("MyContract address:", myContract);
  console.log("Contract deployed from:", myContract.runner.address);
  console.log("Contract target:", myContract.target);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().then(()=>{

}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* 
MyContract address: BaseContract {
  target: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  interface: Interface {
    fragments: [
      [ConstructorFragment], [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [ErrorFragment],    [ErrorFragment],
      [ErrorFragment],       [EventFragment],    [EventFragment],
      [EventFragment],       [EventFragment],    [EventFragment],
      [EventFragment],       [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment], [FunctionFragment],
      [FunctionFragment],    [FunctionFragment]
    ],
    deploy: ConstructorFragment {
      type: 'constructor',
      inputs: [Array],
      payable: false,
      gas: null
    },
    fallback: null,
    receive: false
  },
  runner: HardhatEthersSigner {
    _gasLimit: 30000000,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    provider: HardhatEthersProvider {
      _hardhatProvider: [LazyInitializationProviderAdapter],
      _networkName: 'localhost',
      _blockListeners: [],
      _transactionHashListeners: Map(0) {},
      _eventListeners: []
    }
  },
  filters: {},
  fallback: null,
  [Symbol(_ethersInternal_contract)]: {}
}
*/