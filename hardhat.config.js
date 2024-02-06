require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: process.env.ALCHEMY_TESTNET_RPC_URL, 
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
    }
  },

  // solidity: "0.8.19",
  solidity: {
    version: "0.8.20",
    settings: { 
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
}; 
