var express = require('express');
var router = express.Router();

const {Web3} = require('web3');
const fs = require('fs');
const path = require('path');
const {getAddressSendHistory , insertDB ,getTokenList, checkAddress , updateWalletInfo, getAllHistory, historyUpdate, historyDelete,checkUser} = require('../mysql');
const { threadId } = require('worker_threads');
const { throws } = require('assert');
const BigNumber = require('bignumber.js');
const axios = require('axios');
require('dotenv').config();

//트론
const TronWeb = require('tronweb');

// Tron 노드 URL 설정
const fullNode = 'https://api.trongrid.io'; // 메인넷 노드
const solidityNode = 'https://api.trongrid.io'; // 메인넷 솔리디티 노드
const eventServer = 'https://api.trongrid.io'; // 메인넷 이벤트 서버
const tronapikey = '882abac6-31cd-4bb4-8587-ae84d84f8a5b'; // 메인넷 이벤트 서버

// TronWeb 인스턴스 생성
// const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

const EVCtokenContractAddress = "TNmtt9SBLsHmzAUvdwsbnH2aK4Gbnocagy";
/* GET home page. */
// const privateKey = await fs.readFileSync(`./user/${user_id}/privateKey`, 'utf8');


// const tronWeb = new TronWeb({
//   fullHost: 'https://api.trongrid.io',
//   headers: { 'TRON-PRO-API-KEY': '882abac6-31cd-4bb4-8587-ae84d84f8a5b' },
//   privateKey: privateKey
// });

router.post('/create/account', async function(req, res, next) {
  const user_id = req.body.user_id;
  
  try {


    // TronWeb 인스턴스 생성
    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
    
    await insertDB('users', req.body, async (error, results) => {
      if (error) {
        res.status(500).send('서버 오류 발생');
      } else {
        const account = tronWeb.createAccount();
        account.then( async (account_result) => {
            await makeKeyFile(user_id, account_result.address.base58,'address');
            await makeKeyFile(user_id, account_result.address.hex,'hex');
            await makeKeyFile(user_id, account_result.publicKey,'publicKey');
            await makeKeyFile(user_id, account_result.privateKey,'privateKey');
            
            var user_account ={};
            user_account.user_srl = results.insertId;
            user_account.wallet = 'TRON';
            user_account.token_name = 'TRON';
            user_account.address = account_result.address.base58;
            // console.log(user_account);
            await insertDB('walletinfo', user_account, async (error, results) => {
              if (error) {
                res.status(500).send(error);
              }else {
                /* res.status(201).send(`사용자 추가됨: ${results.insertId}`); */
              }}
            );
            var user_token_account = {};
            user_token_account.user_srl = results.insertId;
            user_token_account.wallet = 'TRON';
            user_token_account.token_name = 'EVC';
            user_token_account.address = account_result.address.base58;


            await insertDB('walletinfo', user_token_account, async (error, results) => {
              if (error) {
                res.status(500).send(error);
              }else {
                res.status(201).send("success");
              }}
            );
        });
      }}
    );
  } catch (error) {
    console.log('error: ' + error);
  }
});

router.post('/getTronAddress', async function (req, res, next) {
  try {
    const user_id = req.body.user_id;
    // 비동기 방식으로 파일 읽기
    const address = fs.readFileSync(`./user/${user_id}/TRON/address`, 'utf8');
    res.status(201).send({ address: address });
  } catch (error) {
    console.error('Error reading address file:', error);
    // 파일을 읽는 중 에러가 발생하면 500 상태 코드를 클라이언트로 전송
    res.status(500).send({ result: 'error', message: 'Failed to read address file' });
    // 또는 next(error)로 에러 처리 미들웨어로 전달
  }
});


router.post('/getAddressBalance', async function(req, res, next) {

  var address = req.body.address;
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

  if (!address || address.trim() === '' || !tronWeb.isAddress(address)) {
    // 주소가 없거나 빈 값이거나 잘못된 형식일 경우 에러 메시지 반환
    return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
  }

  await tronWeb.trx.getBalance(address)
    .then(balance => {
      console.log('Balance:', tronWeb.fromSun(balance), 'TRX');
      res.status(201).send({ result: 'success', balance: tronWeb.fromSun(balance) });
    })
    .catch(error => {
      console.error('Error fetching balance:', error);
      res.status(500).send({ result: 'error', message: 'Failed to fetch balance', error: error.message });
    });
});

router.post('/getAddressTokenBalance', async function(req, res, next) {
  const userAddress = req.body.address;
  
    // TronWeb 인스턴스 생성
    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

  if (!userAddress || userAddress.trim() === '' || !tronWeb.isAddress(userAddress)) {
    // 주소가 없거나 빈 값이거나 잘못된 형식일 경우 에러 메시지 반환
    return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
  }

  try {
    // 계약 인스턴스 가져오기
    const contract = await tronWeb.contract().at(EVCtokenContractAddress);
    tronWeb.setAddress(userAddress);
    
    // 사용자 주소의 잔액을 가져옵니다.
    let balance = 0;
    try {
      balance = await contract.methods.balanceOf(userAddress).call();
      console.log('Raw Balance (in Sun):', balance.toString());
    } catch (error) {
      console.error('잔액 조회 중 오류 발생:', error.response?.data || error.message);
      throw error; // 에러 다시 던지기
    }

    // 소수점 단위를 적용하여 변환 (예: 소수점 자릿수 18)
    const decimals = 18; // 토큰의 소수점 자릿수
    const decimalBalance = new BigNumber(balance.toString()).dividedBy(new BigNumber(10).pow(decimals)).toString();

    console.log('EVC Balance:', decimalBalance);

    // 성공 응답 반환
    res.status(200).send({ result: 'success', balance: decimalBalance });
  } catch (error) {
    console.error('잔액 조회 중 오류 발생:', error);
    res.status(500).send({ result: 'error', message: 'Failed to fetch token balance', error: error.message });
  }
});


router.post('/transfer', async function(req, res, next) {
  const user_id = req.body.user_id;
  const user_srl = req.body.user_srl;
  const token_name = req.body.token_name;
  const senderAddress = req.body.from_address;
  const receiverAddress = req.body.to_address;
  const amount = req.body.amount; // 실제 전송할 토큰 수량 (예: 1)
  
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).send({ result: 'error', message: 'Invalid amount provided' });
  }

  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();

  try {
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey,
    });

    const contract = await tronWeb.contract().at(EVCtokenContractAddress);

    const decimals = 18;
    const tokenAmount = BigInt(amount) * BigInt(10) ** BigInt(decimals);

    const transaction = await contract.methods.transfer(receiverAddress, tokenAmount).send({
      from: senderAddress,
    });

    console.log('Transaction result:', transaction);
    // Transaction result: e3190c6f6fc6ee1daf15d631adf814b5766e16b2facbba7d4a33b589337c1609


    if (!transaction ) {
      throw new Error('Transaction failed or txID missing');
    }

    const historyData = {
      token_name:token_name,
      user_srl:user_srl,
      user_id:user_id,
      from_address: senderAddress,
      to_address: receiverAddress,
      amount: amount,
      usedFee: 0,
      IsExternalTrade: 'true',
      transactionHash: transaction,
    };
console.log("send historyData: "+ historyData);
    try {
      insertDB(token_name + '_history', historyData, (error , result)=>{
        if(error){
          return res.status(500).send({ result: 'error', message: 'Failed to save transaction history' });
        }
        return res.status(200).send({ result: 'success' });
      });
    } catch (dbError) {
      console.error('Database insert error:', dbError);
      return res.status(500).send({ result: 'error', message: 'Failed to save transaction history' });
    }


  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).send({ result: 'error', message: 'Failed to transfer token', error: error.message });
  }
});

router.post('/transferToken', async function (req, res) {
  const { user_id, user_srl, token_name, from_address: senderAddress, to_address: receiverAddress, amount } = req.body;

  if (!user_id || !user_srl || !token_name || !senderAddress || !receiverAddress || isNaN(amount) || amount <= 0) {
    return res.status(400).send({ result: 'error', message: 'Invalid input parameters' });
  }

  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();

  try {
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey,
    });

    const tokenContractAddress = EVCtokenContractAddress;
    const decimals = 18;
    const tokenAmount = BigInt(amount) * BigInt(10) ** BigInt(decimals);

    const functionSelector = 'transfer(address,uint256)';
    const parameter = [
      { type: 'address', value: receiverAddress },
      { type: 'uint256', value: tokenAmount },
    ];

    const tx = await tronWeb.transactionBuilder.triggerSmartContract(
      tokenContractAddress,
      functionSelector,
      { feeLimit: 10000000 },
      parameter,
      senderAddress
    );

    if (!tx || !tx.transaction) {
      throw new Error("Failed to trigger smart contract.");
    }

    console.log("Trigger Smart Contract TX:", tx);

    const signedTx = await tronWeb.trx.sign(tx.transaction, privateKey);
    if (!signedTx) {
      throw new Error("Failed to sign the transaction.");
    }

    console.log("Signed TX:", signedTx);

    const result = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!result || !result.result || !result.txid) {
      throw new Error("Transaction failed. Details: " + JSON.stringify(result));
    }

    console.log("Transaction Result:", result);

    const historyData = {
      token_name,
      user_srl,
      user_id,
      from_address: senderAddress,
      to_address: receiverAddress,
      amount,
      usedFee: 0,
      IsExternalTrade: 'true',
      transactionHash: result.txid,
    };

    await new Promise((resolve, reject) => {
      insertDB(`${token_name}_history`, historyData, (error) => {
        if (error) {
          console.error('Database insert error:', error);
          return reject(error);
        }
        resolve();
      });
    });

    res.status(200).send({ result: 'success', transaction: result });
  } catch (error) {
    console.error('Transaction Error:', error.response ? error.response.data : error.message || error);
    res.status(500).send({ result: 'error', message: error.message });
  }
});



router.get('/tron/getBalance',  function(req, res, next) {
  const sender = req.body.sender;
  const recipient = req.body.recipient;
  const amount = tronWeb.toSun(1); // 1 TRX
  
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
  
  // 발신자의 프라이빗 키 가져오기
  const privateKey =  fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8'); // 발신자의 프라이빗 키

  tronWeb.trx.sendTransaction(recipient, amount, privateKey).then(result => {
      // console.log('Transaction result:', result);
  }).catch(err => {
      // console.error('Transaction error:', err);
  });
});

async function makeKeyFile(user_id,content,fileName){
  const isExists = fs.existsSync(`/user/${user_id}/TRON`);
  if(!isExists){
    await fs.mkdir(`./user/${user_id}/TRON`, { recursive: true }, (err) =>{
      console.error(err);
      return;
    });
  }
  fs.writeFile(`./user/${user_id}/TRON/${fileName}`, content, (err) => {
      if (err) {
          console.error('파일 쓰기 중 오류 발생:', err);
          return;
      }
      console.log('파일이 성공적으로 생성되었습니다.');
      return "SUCCESS";
  });
}


router.post('/getTokenList', function(req, res, next) {
  try {
    const user_srl = req.body.user_srl;

    getTokenList(user_srl ,async (error, results) => {
      if(error){
        throw error;
      }
      res.status(200).send({ result: 'success', data: results});
    });
    
  } catch (error) {
    res.status(404).send({ result: 'error', msg: error});
  }

})

router.post('/api/etherscan/history', function(req, res, next){

})

//데이터 안에 잔고 가져오기
router.post('/getBalance', async function(req, res, next) {
  try {
    const token_name= req.body.token_name;
    const user_address = req.body.address;
    await getTokenBalance(token_name, user_address, (results) => {
      if(results =="" || results == undefined || results == null) {
        res.status(200).send(
          {result: "success", balance: 0}
        )
      }
      res.status(200).send(
        {result: "success", balance: results}
      )
    });
  } catch (error) {
    res.status(500).send({result: "error", error: error})
  }
});


// 토큰 잔액 및 허용량 가져오기
router.post('/getAddressTokenAvailableBalance', async function (req, res, next) {
  const userAddress = req.body.address; // 사용자 주소
  const spenderAddress = req.body.spender; // 스마트 계약 또는 위임받은 주소
  
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
  
  if (!userAddress || userAddress.trim() === '' || !tronWeb.isAddress(userAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
  }

  if (!spenderAddress || spenderAddress.trim() === '' || !tronWeb.isAddress(spenderAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid spender address provided' });
  }

  try {
    // 스마트 계약 인스턴스 가져오기
    const contract = await tronWeb.contract().at(EVCtokenContractAddress);

    // 사용자 주소의 토큰 잔액 조회
    const balance = await contract.methods.balanceOf(userAddress).call();
    console.log('Raw Balance:', balance.toString());

    // 특정 spender의 허용량 조회
    const allowance = await contract.methods.allowance(userAddress, spenderAddress).call();
    console.log('Allowance:', allowance.toString());

    // 소수점 단위 처리 (예: 18자리 소수점)
    const decimals = 18;
    const tokenBalance = new BigNumber(balance.toString()).dividedBy(new BigNumber(10).pow(decimals));
    const tokenAllowance = new BigNumber(allowance.toString()).dividedBy(new BigNumber(10).pow(decimals));

    // 전송 가능한 수량 계산 (잔액과 허용량 중 더 작은 값)
    const availableBalance = BigNumber.min(tokenBalance, tokenAllowance).toString();

    console.log('Available Balance:', availableBalance);

    // 성공 응답 반환
    res.status(200).send({ result: 'success', balance: availableBalance });
  } catch (error) {
    console.error('잔액 및 허용량 조회 중 오류 발생:', error);
    res.status(500).send({ result: 'error', message: 'Failed to fetch available balance', error: error.message });
  }
});

// 진행 중인 트랜잭션 저장 (예제: 메모리 저장소 사용)
const pendingTransactions = {};

router.post('/getAvailableTokenBalance', async function (req, res, next) {
  const userAddress = req.body.address;
  
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
  
  if (!userAddress || userAddress.trim() === '' || !tronWeb.isAddress(userAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
  }

  try {
    // 스마트 계약 인스턴스 가져오기
    const contract = await tronWeb.contract().at(EVCtokenContractAddress);

    // 현재 블록체인의 잔액 조회
    const balance = await contract.methods.balanceOf(userAddress).call();
    const decimals = 18;
    const tokenBalance = new BigNumber(balance.toString()).dividedBy(new BigNumber(10).pow(decimals));

    console.log(`Raw Balance: ${tokenBalance.toString()}`);

    // 진행 중인 전송 금액 계산
    const pendingAmount = new BigNumber(
      pendingTransactions[userAddress] || 0
    );

    console.log(`Pending Amount: ${pendingAmount.toString()}`);

    // 전송 가능한 가상 잔액 계산
    const availableBalance = tokenBalance.minus(pendingAmount).toFixed();

    console.log(`Available Balance: ${availableBalance}`);

    // 응답 반환
    res.status(200).send({ result: 'success', availableBalance });
  } catch (error) {
    console.error('잔액 조회 중 오류 발생:', error);
    res.status(500).send({ result: 'error', message: 'Failed to fetch available balance', error: error.message });
  }
});

// 트랜잭션 등록 (진행 중인 전송 금액 추가)
router.post('/addPendingTransaction', function (req, res) {
  const { fromAddress, amount } = req.body;
  
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
  
  if (!fromAddress || !tronWeb.isAddress(fromAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid fromAddress' });
  }

  const decimals = 18;
  const pendingAmount = new BigNumber(amount).multipliedBy(new BigNumber(10).pow(decimals));

  // 진행 중인 금액 업데이트
  pendingTransactions[fromAddress] = new BigNumber(
    pendingTransactions[fromAddress] || 0
  ).plus(pendingAmount).toString();

  console.log(`Pending Transactions Updated: ${JSON.stringify(pendingTransactions)}`);

  res.status(200).send({ result: 'success', pendingTransactions });
});

// 트랜잭션 완료 처리 (진행 중인 전송 금액 제거)
router.post('/removePendingTransaction', function (req, res) {
  const { fromAddress, amount } = req.body;
  
  // TronWeb 인스턴스 생성
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
  
  if (!fromAddress || !tronWeb.isAddress(fromAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid fromAddress' });
  }

  const decimals = 18;
  const pendingAmount = new BigNumber(amount).multipliedBy(new BigNumber(10).pow(decimals));

  // 진행 중인 금액 제거
  pendingTransactions[fromAddress] = new BigNumber(
    pendingTransactions[fromAddress] || 0
  ).minus(pendingAmount).toString();

  if (new BigNumber(pendingTransactions[fromAddress]).isLessThanOrEqualTo(0)) {
    delete pendingTransactions[fromAddress];
  }

  console.log(`Pending Transactions Updated: ${JSON.stringify(pendingTransactions)}`);

  res.status(200).send({ result: 'success', pendingTransactions });
});



// 수동 송금 내역 확인 및 일괄 업데이트
router.get('/checkTransactionStatus', async function (req, res) {
  try {
    var coinList = ["tron","evc"];
    // var coinList = ["tron"];
    const delay = 300; // 요청 간 200ms 지연 (초당 약 5개 요청)

    for (const coin of coinList) {
      // console.log(`Processing coin: ${coin}`);

      const histories = await new Promise((resolve, reject) => {
        getAllHistory(coin, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
      });

      for (const history of histories) {
        await throttle(async () => {
          await checkTransactionStatus(coin ,history.transactionHash);
        }, delay);
      }
    }

    return res.json({ status: "success" });
  } catch (error) {
    console.error("Error checking checkTransactionStatus transaction status:", error);
    return res.json({ status: "error", error: error.message });
  }
});


//수동 송금 내역 확인 및 개별 업데이트
router.post('/checkTransactionStatus', async function (req, res) {
  const transactionHash = req.body.transactionHash;
  const coin_name = req.body.coin_name;
  // const transactionHash = "82bcfda61b3a42852dd44057afe424d66a7c66d8dc2dda5034f026c5eadcb02a";
  // console.log(transactionHash);

  try {
    const transactionStatus = await checkTransactionStatus(coin_name , transactionHash);
    
    return  { result: "success" , status: transactionStatus };
  } catch (error) {
    console.error("Error checking checkTransactionStatus transaction status:", error);
    return { result: "error", error: error.message };
  }
});

let isRunning = false;

setInterval(async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    await statusManager();
  } catch (error) {
    console.error("Error during scheduled task:", error);
  } finally {
    isRunning = false;
  }
}, 90000); // 1분30초마다 실행

router.get('/statusManager', async function (req, res) {
  statusManager();
});

async function statusManager(){
  try {
    var coinList = ["tron","evc"];
    // var coinList = ["tron"];
    const delay = 300; // 요청 간 200ms 지연 (초당 약 5개 요청)

    for (const coin of coinList) {
      // console.log(`Processing coin: ${coin}`);

      const histories = await new Promise((resolve, reject) => {
        getAllHistory(coin, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
      });
      // console.log("check :"+JSON.stringify(histories));return;
      for (const history of histories) {
        await throttle(async () => {
          await checkTransactionStatus(coin ,history.transactionHash);
        }, delay);
      }
    }

  } catch (error) {
    console.error("Error checking statusManager status:", error);
  }
}



async function checkTransactionStatus(coin_name, transactionHash){
  // console.log(transactionHash);
  try {
    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
    // 트랜잭션 조회
    const transaction = await tronWeb.trx.getTransaction(transactionHash);

    if (!transaction) {
      console.log("Transaction not found. It may still be processing.");
      return { status: "processing" }; // 트랜잭션이 아직 진행 중일 가능성
    }
    // 트랜잭션 정보 조회
    const transactionInfo = await tronWeb.trx.getTransactionInfo(transactionHash);
    console.log(JSON.stringify(transactionInfo));
    if (!transactionInfo) {
      console.log("Transaction info not available yet.");
      var updateData = {
        coin_name: coin_name,
        transactionHash: transactionHash,
        status: "pending",
      };
      console.log(updateData);
      historyUpdate(updateData ,async (error, results) => {
        if(error){
          throw error;
        }
      });
      return { status: "pending" }; // 정보가 아직 확인되지 않음
    }

    // 상태 확인
    if (transactionInfo.receipt.result === "SUCCESS") {
      console.log("Transaction is successful.");
    
      // 사용된 Fee 계산 (Sun을 TRX로 변환)
      const usedFee = transactionInfo.fee / 1_000_000; // Sun -> TRX 변환
    
      var updateData = {
        coin_name: coin_name,
        transactionHash: transactionHash,
        usedFee: usedFee, // 사용된 Fee 추가
        status: "complete",
      };
      console.log(updateData);
      historyUpdate(updateData, async (error, results) => {
        if (error) {
          console.error("Error updating transaction history:", error);
          throw error;
        }
      });
    
      return { status: "success", info: transactionInfo };
    } else {
      console.log("Transaction failed.");
    
      // 실패한 경우에도 사용된 Fee 계산
      const usedFee = transactionInfo.fee / 1_000_000; // Sun -> TRX 변환
    
      var updateData = {
        coin_name: coin_name,
        transactionHash: transactionHash,
        usedFee: usedFee, // 사용된 Fee 추가
        status: "failed",
      };
    console.log(updateData);
      historyUpdate(updateData, async (error, results) => {
        if (error) {
          console.error("Error updating transaction history:", error);
          throw error;
        }
      });
    
      return { status: "failed", info: transactionInfo };
    }
  } catch (error) {
    console.error("Error checking checkTransactionStatus transaction status:", error);
    const errorMessage = error.message || error.toString();
    if (errorMessage.includes("Transaction not found")) {
      historyDelete(transactionHash, (err, result) => {
        if (err) {
          console.error("Failed to delete history:", err);
        } else {
          console.log("History deleted successfully.");
        }
      });
    }
  }
}

async function throttle(fn, delay) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      resolve(await fn());
    }, delay);
  });
}

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

// 스테이킹 테스트
router.get('/stakingtest', async function (req, res) {
  const user_id = "test2";
  const freezeAmount = 10000000; // 스테이킹할 금액 (10 TRX = 10,000,000 Sun)
  const freezeDays = 3; // 스테이킹 기간 (3일)
  const resourceType = 'ENERGY'; // 에너지 확보를 위한 설정

  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');

  try {

    // TronWeb 인스턴스 생성
    // const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': '882abac6-31cd-4bb4-8587-ae84d84f8a5b' },
      privateKey: privateKey
    });
  
    const freezeTx = await tronWeb.trx.freezeBalance(freezeAmount, freezeDays, resourceType, senderAddress);
    const signedFreezeTx = await tronWeb.trx.sign(freezeTx, privateKey);
    const freezeResult = await tronWeb.trx.sendRawTransaction(signedFreezeTx);
    console.log('Energy Staking Result:', freezeResult);
  } catch (error) {
    console.error('Staking Error:', error);
  }

});
//스테이킹 확인
router.get('/stakingtest2', async function (req, res) {
  const user_id = "test2";
  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";

  const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': '882abac6-31cd-4bb4-8587-ae84d84f8a5b' },
    privateKey: privateKey
  });
  const resources = await tronWeb.trx.getAccountResources(address);
  // 1 Bandwidth = 1 TRX / 1000 바이트.
  // Account Resources: {
  //   freeNetLimit: 600,
  //   assetNetUsed: [ { key: '1005027', value: 0 } ],
  //   assetNetLimit: [ { key: '1005027', value: 0 } ],
  //   TotalNetLimit: 43200000000,
  //   TotalNetWeight: 29308225468,
  //   TotalEnergyLimit: 180000000000,
  //   TotalEnergyWeight: 14837971189
  // }
  console.log('Account Resources:', resources);
});1
//스테이킹 하기
router.get('/stakingtest2', async function (req, res) {
  const user_id = "test2";
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";
  const freezeAmount = 10000000; // 스테이킹할 금액 (10 TRX = 10,000,000 Sun)
  const freezeDays = 3; // 스테이킹 기간 (3일)
  const resourceType = 'ENERGY'; // 에너지 확보를 위한 설정

  try {
    const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': '882abac6-31cd-4bb4-8587-ae84d84f8a5b' },
      privateKey: privateKey
    });
    const freezeTx = await tronWeb.trx.freezeBalance(freezeAmount, freezeDays, resourceType, address);
    const signedFreezeTx = await tronWeb.trx.sign(freezeTx, privateKey);
    const freezeResult = await tronWeb.trx.sendRawTransaction(signedFreezeTx);
    console.log('Energy Staking Result:', freezeResult);
    const resources = await tronWeb.trx.getAccountResources(address);
    console.log('Account Resources:', resources);
  } catch (error) {
    console.error('Staking Error:', error);
  }
});
//호출 비용 확인
router.get('/stakingtest3', async function (req, res) {
  const user_id = "test2";
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";
  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');
  const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': '882abac6-31cd-4bb4-8587-ae84d84f8a5b' },
    privateKey: privateKey
  });
  const resources = await tronWeb.trx.getAccountResources(address);
  console.log('Account Resources:', resources);
});

// TRX 스테이킹 해제
async function unfreezeTRX(resourceType = "ENERGY") {
  try {
    const user_id = "test2";
    const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";
    const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey,
    });
    const result = await tronWeb.trx.unfreezeBalance(resourceType);
    console.log("Unfreeze successful:", result);
  } catch (error) {
    console.error("Error unfreezing TRX:", error);
  }
}

//전송시 예상 수수료
router.post('/energytest', async function (req, res) {
  const user_id = req.body.user_id;
  const address = req.body.from_address;
  const to_address = req.body.to_address;
  const amount = req.body.amount;
  const coin_name = req.body.token_name;
  // 예상 에너지(estimatedEnergy), 
  // 사용 가능한 에너지(availableEnergy), 
  // 부족 에너지(energyDeficit), 
  // 소모될 TRX 비용(trxCost)을 반환
  expectEnergy(user_id, address, to_address , amount , coin_name)
  .then(result => {
    console.log("Energy Calculation Result:", result);
    res.status(200).send({ result: 'success', estimated: result });
  })
  .catch(error => {
    console.error("Error:", error);
    res.status(500).send({ result: 'error' });
  });
});

// 코인을 전송할때 대략적인 에너지 확인
async function expectEnergy(user_id, address, to_address, amount, coin_name) {
  try {
    const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey: privateKey,
    });

    if (coin_name === 'TRON') {
     // TRX 전송 에너지 계산
     console.log("Estimating energy for TRX transfer...");

     if (!tronWeb.isAddress(address)) {
       throw new Error("Invalid receiver address.");
     }

     if (isNaN(amount) || amount <= 0) {
       throw new Error("Invalid transfer amount.");
     }
     // TRX 전송을 위한 기본 트랜잭션 생성
     const transaction = await tronWeb.transactionBuilder.sendTrx(
        to_address, // 수신자 주소
        amount * 10 ** 6, // 전송량 (1 TRX = 1,000,000 Sun)
        address // 발신자 주소
     );
     if (!transaction) {
       throw new Error("Failed to create transaction.");
     }

     // 트랜잭션 정보에서 Bandwidth 계산
     const bandwidthEstimate = transaction.raw_data_hex.length / 2; // 바이트 수
     console.log(`Estimated Bandwidth: ${bandwidthEstimate} bytes`);

     const resources = await tronWeb.trx.getAccountResources(tronWeb.defaultAddress.base58);
     console.log("Account Resources:", resources);

     const availableBandwidth = resources.freeNetLimit - resources.freeNetUsed;
     console.log("Available Bandwidth:", availableBandwidth);

     const bandwidthDeficit = Math.max(0, bandwidthEstimate - availableBandwidth);
     const trxCost = bandwidthDeficit > 0 ? (bandwidthDeficit / 1000).toFixed(6) : 0;
     console.log("Estimated TRX Cost:", trxCost);

     return {
       estimatedBandwidth: bandwidthEstimate,
       availableBandwidth,
       bandwidthDeficit,
       trxCost,
     };
    } else if (coin_name === 'EVC') {
      // TRC-20 토큰 전송 에너지 계산
      console.log("Estimating energy for TRC-20 transfer...");

      const contract = await tronWeb.contract().at(EVCtokenContractAddress);

      const functionSelector = 'transfer(address,uint256)';
      const decimals = 18;
      const tokenAmount = BigInt(amount) * BigInt(10 ** decimals);

      const parameter = [
        { type: 'address', value: tronWeb.address.toHex(address) },
        { type: 'uint256', value: tokenAmount.toString() },
      ];

      // 트랜잭션 에너지 추정
      const triggerResult = await tronWeb.transactionBuilder.triggerConstantContract(
        tronWeb.address.toHex(EVCtokenContractAddress),
        functionSelector,
        {},
        parameter,
        tronWeb.address.toHex(address)
      );

      if (!triggerResult || !triggerResult.energy_used) {
        throw new Error("Failed to estimate energy usage.");
      }

      console.log("Trigger Result:", triggerResult);
      const estimatedEnergy = triggerResult.energy_used;
      console.log("Estimated Energy:", estimatedEnergy);

      const resources = await tronWeb.trx.getAccountResources(address);
      console.log("Account Resources:", resources);

// 기본값을 설정하여 NaN 방지
const availableEnergy = (resources.TotalEnergyLimit || 0) - (resources.TotalEnergyWeight || 0);

const energyDeficit = Math.max(0, estimatedEnergy - availableEnergy);
const trxCost = energyDeficit > 0 ? (energyDeficit / 280).toFixed(6) : 0;
console.log("Energy Calculation Result:", {
  estimatedEnergy: estimatedEnergy,
  availableEnergy: availableEnergy,
  energyDeficit: energyDeficit,
  trxCost: trxCost,
});

      return {
        estimatedEnergy: estimatedEnergy,
        availableEnergy: availableEnergy,
        energyDeficit: energyDeficit,
        trxCost: trxCost,
      };
    } else {
      throw new Error("Unsupported coin type.");
    }
  } catch (error) {
    console.error("Error estimating energy:", error.message);
    return null;
  }
}

router.get('/test', async function (req, res) {
  const user_id = "test2";
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";
  getStakingAmount(user_id, address);
});


//스테이킹 된 금액 확인
async function getStakingAmount(user_id , address) {
  try {
    const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey: privateKey,
    });

    const resources = await tronWeb.trx.getAccountResources(address);
    console.log("Account Resources:", resources);

    // 스테이킹된 Bandwidth와 Energy
    const energyStaked = resources.TotalEnergyWeight;
    const bandwidthStaked = resources.TotalNetWeight;

    // Bandwidth 기준 스테이킹된 TRX 추산
    console.log("Staked for Bandwidth:", bandwidthStaked / 1e6, "TRX");

    // Energy 기준 스테이킹된 TRX 추산
    console.log("Staked for Energy:", energyStaked / 1e6, "TRX");

    return {
      bandwidthStaked: bandwidthStaked / 1e6,
      energyStaked: energyStaked / 1e6,
    };
  } catch (error) {
    console.error("Error fetching staking data:", error.message);
    return null;
  }
}


module.exports = router;
