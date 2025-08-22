var express = require('express');
var router = express.Router();
const fs = require('fs');
const path = require('path');

require('dotenv').config();
const {Web3} = require('web3');
const hre = require("hardhat");
// import Web3 from 'web3';
const {getAddressSendHistory, checkUser ,insertDB } = require('../mysql');

const { encryptPrivateKey, decryptPrivateKey} = require("../util/crypto.js");

// ERC-20 토큰 주소와 ABI 설정
const tokenABI = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"lockAddress","type":"address"},{"name":"lockType","type":"uint8"},{"name":"endtimeList","type":"uint256[]"},{"name":"remainList","type":"uint256[]"}],"name":"lock","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"unpause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"paused","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"pause","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"to","type":"address"},{"name":"value","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"lockData","outputs":[{"name":"lockType","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"lockAddress","type":"address"},{"indexed":true,"name":"lockType","type":"uint8"},{"indexed":false,"name":"endtimeList","type":"uint256[]"},{"indexed":false,"name":"remainList","type":"uint256[]"}],"name":"Lock","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Paused","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"account","type":"address"}],"name":"Unpaused","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}];

router.get('/check',async(req, res, next) => {

    // const user_id = req.body.user_id;
    const user_id = req.query.user_id;
    const address = req.query.address;
    // let key = req.query.key;
    // console.log(key);
    // if(key == "" || key == null){
    //     key = path.join(__dirname, '..',`user`,`${user_id}`,`privateKey`);
    //   };
    // const senderPrivateKey = key;
    const key = path.join(__dirname, '..',`user`,`${user_id}`,`privateKey`);
    const senderPrivateKey =fs.readFileSync(keyPath, 'utf8');
    // const senderPrivateKey = decryptPrivateKey(key);

    var balance = getTokenBalance(senderPrivateKey, address);
    // console.log(balance);
});

// router.post('/create_account', async function (req, res, next) {
//   const user_id = req.body.user_id;
//   const email = req.body.email;
//   // try {
//     // 유저 아이디 체크
//     const result = await checkUser(user_id , email);
//     if (result.length > 0) {
//       console.log(JSON.stringify(result));
//       // 아이디가 이미 존재하면 응답 후 종료
//       return res.status(201).send('exist');
//     };

//   // 이더와 LOTT 지갑 생성
//   try {
//     await insertDB('users', req.body, async (error, results) => {
//       if (error) {
//         return res.status(500).send('서버 오류 발생');
//       } else {
//         const account = hre.ethers.Wallet.createRandom();

//         await makeKeyFile(user_id, account.address, 'address');
//         await makeKeyFile(user_id, account.privateKey, 'privateKey');

//         const user_account = {
//           user_srl: results.insertId,
//           wallet: 'ETH',
//           token_name: 'ETH',
//           address: account.address,
//         };

//         await insertDB('walletinfo', user_account, async (error, results) => {
//           if (error) {
//             console.log(error);
//             return res.status(500).send(error);
//           }
//         });
 
//         const user_lott_account = {
//           user_srl: results.insertId,
//           wallet: 'ETH',
//           token_name: 'LOTT',
//           address: account.address,
//         };

//         await insertDB('walletinfo', user_lott_account, async (error, results) => {
//           if (error) {
//             console.log(error);
//             return res.status(500).send(error);
//           } else {
//             return res.status(201).send('success');
//           }
//         });
//       }
//     });
//   } catch (error) {
//     console.error('Error:', error);
//     return res.status(500).send('Internal Server Error');
//   }
// });

router.post('/create_account', async function (req, res, next) {
  const user_id = req.body.user_id;
  const email = req.body.email;

  try {

    const result = await checkUser(user_id , email);
    if (result.length > 0) {
      // 아이디가 이미 존재하면 응답 후 종료
      return res.status(201).send('exist');
    };

    // users 테이블에 데이터 삽입
    const userResults = await insertDB('users', req.body);
    
    // ETH 계정 생성
    const account = hre.ethers.Wallet.createRandom();

    // 키 파일 생성
    await Promise.all([
      makeKeyFile(user_id, account.address, 'address'),
      makeKeyFile(user_id, account.privateKey, 'privateKey'),
    ]);

    // walletinfo 테이블에 데이터 삽입
    const walletData = [
      {
        user_srl: userResults.insertId,
        wallet: 'ETH',
        token_name: 'ETH',
        address: account.address,
      },
      {
        user_srl: userResults.insertId,
        wallet: 'ETH',
        token_name: 'LOTT',
        address: account.address,
      },
    ];

    for (const data of walletData) {
      await insertDB('walletinfo', data);
    }
    // 성공 응답
    // res.status(201).send('success');
    res.status(201).send({result:"success", privateKey: account.privateKey});
  } catch (error) {
    console.error('error:', error);
    res.status(500).send('서버 오류 발생');
  }
});


// 이더 잔고 가져오기
router.post('/getAddressBalance', async function (req, res, next) {
    try {
        const { address } = req.body;
        const web3 = new Web3(process.env.ALCHEMY_TESTNET_RPC_URL);

        // 주소 유효성 검사 (최신 Web3.js 방식)
        if (!web3.utils.isAddress(address)) {
          return res.status(400).send({ result: "error", message: "Invalid Ethereum address" });
        }
        // ETH 잔고 가져오기
        const balanceWei = await web3.eth.getBalance(address);
        const balanceEth = web3.utils.fromWei(balanceWei, 'ether'); // 잔고를 ETH 단위로 변환
        // console.log(balanceEth);
        res.status(200).send({ result: "success", balance: balanceEth });
    } catch (error) {
        res.status(500).send({ result: "error", error: error.message });
    }
});


//이더계열 토큰
router.post('/getAddressTokenBalance', async (req, res, next) => {
    const user_id = req.body.user_id;
    const address = req.body.address;
    const key = req.body.key;

    try {
        const keyPath = path.join(__dirname, '..', `user`, `${user_id}`, `privateKey`);
        const senderPrivateKey = fs.readFileSync(keyPath, 'utf8').trim();
        // const senderPrivateKey = decryptPrivateKey(key);

        // getTokenBalance 호출에 await 추가
        const balance = await getTokenBalance(senderPrivateKey, address);
        res.json({ balance: balance });
    } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ error: 'Failed to fetch token balance' });
    }
});

//전송시 예상 수수료
router.post('/energyCheck', async function (req, res) {
  const user_id = req.body.user_id;
  const address = req.body.from_address;
  const to_address = req.body.to_address;
  const amount = req.body.amount;
  const token_name = req.body.token_name;
  // 예상 에너지(estimatedEnergy), 
  // 사용 가능한 에너지(availableEnergy), 
  // 부족 에너지(energyDeficit), 
  // 소모될 TRX 비용(trxCost)을 반환

  estimateEthereumFee(address, to_address, amount, token_name)
    .then(result => {
      console.log("Ethereum Fee Estimate:", result);
      res.status(200).send({ result: 'success', estimated: result });
    })
    .catch(err => {
      console.error("Error:", err);
      res.status(500).send({ result: 'error' });
    });
});





//send 페이지 보낸기록 5개 가져오기
router.post('/getAddressSendHistory', async function (req, res) {
    try {
      getAddressSendHistory(req.body ,async (error, results) => {
        if(error){
          throw error;
        }
        res.status(200).send({ result: 'success', data: results});
      });
    } catch (error) {
      console.error("Error checking getAddressSendHistory transaction status:", error);
      return { status: "error", error: error.message };
    }
});

//send 페이지 보낸기록 5개 가져오기
router.post('/getAddressSendHistory', async function (req, res) {
  try {
    getAddressSendHistory(req.body ,async (error, results) => {
      if(error){
        throw error;
      }
      res.status(200).send({ result: 'success', data: results});
    });
  } catch (error) {
    console.error("Error checking getAddressSendHistory transaction status:", error);
    return { status: "error", error: error.message };
  }
});

async function makeKeyFile(user_id, content, fileName) {
  // 디렉토리 존재 확인
  const dirPath = `./user/${user_id}/ETH`;
  if (!fs.existsSync(dirPath)) {
      try {
          fs.mkdirSync(dirPath, { recursive: true });
      } catch (err) {
          console.error('디렉토리 생성 중 오류 발생:', err);
          throw err; // 에러를 호출자에게 전달
      }
  }

  // 파일 생성
  try {
      fs.writeFileSync(`${dirPath}/${fileName}`, content);
      console.log('파일이 성공적으로 생성되었습니다.');
      return "SUCCESS";
  } catch (err) {
      console.error('파일 쓰기 중 오류 발생:', err);
      throw err; // 에러를 호출자에게 전달
  }
}


// 1. 자산 가져오기 함수(LOTT)
async function getTokenBalance(PRIVATE_KEY, address) {
  const web3 = new Web3(process.env.INFURA_URL);

  // 지갑 설정
  const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;

  // const tokenAddress = '0xB9DB64714B6308A6300D5211f41560fcAa77dFfB'; // TEST
  const tokenAddress = '0xbA93EF534094F8b7001ECe2691168140965341ab'; // LOTT
  const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
  // 토큰 잔액 가져오기
  const balance = await tokenContract.methods.balanceOf(account.address).call();
  const result_balance = web3.utils.fromWei(balance, 'ether');
  // console.log('getTokenBalance');
  // console.log(result_balance);

  return result_balance;
}

// 2. 토큰 전송 함수
async function sendToken(toAddress, amount) {
  const web3 = new Web3(process.env.INFURA_URL);
  const tokenAddress = '0xbA93EF534094F8b7001ECe2691168140965341ab';
  const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
  const amountInWei = web3.utils.toWei(amount.toString(), 'ether');
  const tx = tokenContract.methods.transfer(toAddress, amountInWei);

  const gas = await tx.estimateGas({ from: account.address });
  const gasPrice = await web3.eth.getGasPrice();

  const data = tx.encodeABI();
  const txData = {
      from: account.address,
      to: tokenAddress,
      data: data,
      gas,
      gasPrice
  };

  const receipt = await web3.eth.sendTransaction(txData);
  // console.log(`Transaction hash: ${receipt.transactionHash}`);
  return receipt;
}

// 3. 이더리움 예상 수수료 계산 함수
async function estimateEthereumFee(fromAddress, toAddress, amount, tokenName) {
  try {
      const web3 = new Web3(process.env.INFURA_URL);

      // 기본 트랜잭션 데이터 생성
      const tx = {
          from: fromAddress,
          to: toAddress,
          value: web3.utils.toWei(amount.toString(), 'ether'), // ETH 값을 Wei로 변환
      };

      // 가스 한도 추정
      const gasLimit = await web3.eth.estimateGas(tx);

      // 현재 네트워크 가스 가격 가져오기
      const gasPrice = await web3.eth.getGasPrice();

      // 예상 수수료 계산
      const trxCostWei = BigInt(gasLimit) * BigInt(gasPrice);
      const trxCostEth = web3.utils.fromWei(trxCostWei.toString(), 'ether');

      // BigInt 값을 직렬화 가능한 값으로 변환
      return {
        gasLimit: gasLimit.toString(), // BigInt를 문자열로 변환
        gasPrice: web3.utils.fromWei(gasPrice, 'gwei') + ' Gwei',
        trxCostEth,
      };
  } catch (error) {
      console.error("Error calculating Ethereum fee:", error);
      throw error;
  }
}

// 예제 실행
// (async () => {
//     await getTokenBalance();
//     // await sendToken('<RECEIVER_ADDRESS>', 10); // 10 tokens 전송
// })();

module.exports = router;
