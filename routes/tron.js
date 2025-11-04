var express = require('express');
var router = express.Router();

const {Web3} = require('web3');
const fs = require('fs');
const path = require('path');
const {getAddressSendHistory , insertDB ,getTokenList, checkAddress , updateWalletInfo, getAllHistory, historyUpdate, historyDelete,checkUser, updateWallet , updateWalletAccount} = require('../mysql');
const { threadId } = require('worker_threads');
const { throws } = require('assert');
const BigNumber = require('bignumber.js');
const axios = require('axios');
require('dotenv').config();

//트론
const TronWeb = require('tronweb');


// TESTNET (Nile)
// const fullNode = 'https://nile.trongrid.io';
// const solidityNode = 'https://nile.trongrid.io';
// const eventServer = 'https://nile.trongrid.io';

// Tron 노드 URL 설정
const fullNode = 'https://api.trongrid.io'; // 메인넷 노드
const solidityNode = 'https://api.trongrid.io'; // 메인넷 솔리디티 노드
const eventServer = 'https://api.trongrid.io'; // 메인넷 이벤트 서버
const tronapikey = '882abac6-31cd-4bb4-8587-ae84d84f8a5b'; // 메인넷 이벤트 서버

// TronWeb 인스턴스 생성
// const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

// const EVCtokenContractAddress = "TNmtt9SBLsHmzAUvdwsbnH2aK4Gbnocagy";

//Win 테스트 토큰 주소
// const EVCtokenContractAddress = "TNDSHKGBmgRx9mDYA9CnxPx55nu672yQw2";

// LOTT 토큰 주소
const EVCtokenContractAddress = "TVfuBgFnMHMPRadR9d9pStvTvttBmBrf51";

/* GET home page. */
// const privateKey = await fs.readFileSync(`./user/${user_id}/privateKey`, 'utf8');

router.post('/create_account', async function (req, res, next) {
  const user_id = req.body.user_id;
  const email = req.body.email;

  try {

    const result = await checkUser(user_id , email);
    if (result.length > 0) {
      // 아이디가 이미 존재하면 응답 후 종료
      return res.status(201).send('exist');
    };

    // TronWeb 인스턴스 생성
    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

    // users 테이블에 데이터 삽입
    const userResults = await insertDB('users', req.body);
    
    // Tron 계정 생성
    const account_result = await tronWeb.createAccount();

    // 키 파일 생성
    await Promise.all([
      makeKeyFile(user_id, account_result.address.base58, 'address'),
      makeKeyFile(user_id, account_result.address.hex, 'hex'),
      makeKeyFile(user_id, account_result.publicKey, 'publicKey'),
      makeKeyFile(user_id, account_result.privateKey, 'privateKey'),
    ]);

    // walletinfo 테이블에 데이터 삽입
    const walletData = [
      {
        user_srl: userResults.insertId,
        wallet: 'TRON',
        token_name: 'TRON',
        address: account_result.address.base58,
      },
      {
        user_srl: userResults.insertId,
        wallet: 'TRON',
        token_name: 'LOTT',
        address: account_result.address.base58,
      },
    ];

    for (const data of walletData) {
      await insertDB('walletinfo', data);
    }

    // 성공 응답
    res.status(201).send('success');
    // res.status(201).send({result:"success", privateKey: account_result.privateKey});
  } catch (error) {
    console.error('error:', error);
    res.status(500).send('서버 오류 발생');
  }
});

router.post('/recreate/account', async (req, res) => {
  const user_id  = String(req.body.user_id  || '').replace(/[^\w.-]/g, '');
  const user_srl = req.body.user_srl;
  const filePath = path.join(__dirname, `./user/${user_id}/TRON/address`);

  try {
    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);
    console.log('recreate/account');

    // 이미 주소 파일이 있으면 그대로 반환
    if (fs.existsSync(filePath)) {
      const addr = fs.readFileSync(filePath, 'utf8').trim();
      return res.status(200).send({ result: 'exists', address: addr || null });
    }

    // 신규 계정 생성
    const account = await tronWeb.createAccount(); // Promise를 await로
    const base58   = account.address.base58;
    const hex      = account.address.hex;
    const pubKey   = account.publicKey;
    const privKey  = account.privateKey;

    // 키 파일 저장 (makeKeyFile이 Promise 반환하도록 구현되어 있어야 함)
    await makeKeyFile(user_id, base58,  'address');
    await makeKeyFile(user_id, hex,     'hex');
    await makeKeyFile(user_id, pubKey,  'publicKey');
    await makeKeyFile(user_id, privKey, 'privateKey');

    // DB upsert 유틸: 존재하면 update, 없으면 insert
    const upsertWallet = async (payload) => {
      const exists = await new Promise((resolve, reject) => {
        checkAddress(payload, (err, results) => err ? reject(err) : resolve(results?.length > 0));
      });
      if (exists) {
        await new Promise((resolve, reject) => {
          updateWalletAccount(payload, (err) => err ? reject(err) : resolve());
        });
      } else {
        await new Promise((resolve, reject) => {
          insertDB('walletinfo', payload, (err) => err ? reject(err) : resolve());
        });
      }
    };

    // TRON / LOTT 두 레코드 upsert
    await upsertWallet({
      user_srl, wallet: 'TRON', token_name: 'TRON', address: base58,
    });
    await upsertWallet({
      user_srl, wallet: 'TRON', token_name: 'LOTT', address: base58,
    });

    return res.status(201).send({ result: 'success', address: base58 });
  } catch (error) {
    console.error('recreate/account error:', error);
    return res.status(500).send({ result: 'error', message: 'recreate failed' });
  }
});


router.post('/getAddress', async (req, res) => {
  try {
    const user_id = String(req.body.user_id || '').replace(/[^\w.-]/g, '');
    const filePath = path.join(__dirname, `./user/${user_id}/TRON/address`);

    if (!fs.existsSync(filePath)) {
      return res.status(200).send({ address: null }); // 파일 없음 = 정상 응답
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const address = (raw || '').trim() || null; // 빈 문자열도 null 처리
    return res.status(200).send({ address });
  } catch (error) {
    console.error('getAddress error:', error);
    // ENOENT만 특별 취급하고 나머지는 서버 에러
    if (error.code === 'ENOENT') {
      return res.status(200).send({ address: null });
    }
    return res.status(500).send({ result: 'error', message: 'Failed to read address file' });
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

BigNumber.config({ EXPONENTIAL_AT: 1e9 }); // 지수표기 절대 금지 수준으로 올림

router.post('/getAddressTokenBalance', async function(req, res) {
  const userAddress = (req.body.address || '').trim();
  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

  if (!userAddress || !tronWeb.isAddress(userAddress)) {
    return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
  }

  try {
    const contract = await tronWeb.contract().at(EVCtokenContractAddress);
    tronWeb.setAddress(userAddress);

    // 1) raw balance는 '정수 문자열'로 받기
    let raw = '0';
    try {
      const v = await contract.methods.balanceOf(userAddress).call();
      raw = typeof v === 'string' ? v : v.toString(); // 절대 Number로 변환 X
      console.log('Raw Balance (integer):', raw);
    } catch (e) {
      console.error('잔액 조회 중 오류:', e.response?.data || e.message);
      throw e;
    }

    // 2) decimals도 컨트랙트에서 읽기 (하드코딩 금지)
    let decimals = 6;
    try {
      const d = await contract.methods.decimals().call();
      decimals = Number(d); // 여기서만 Number 허용 (작은 정수)
    } catch (e) {
      console.warn('decimals 조회 실패, 기본 6 사용:', e.message);
    }

    // 3) 사람이 읽는 값으로 변환 (문자열, 지수표기 금지)
    const human = new BigNumber(raw).div(new BigNumber(10).pow(decimals));
    // DB 저장용: 고정 소수 자릿수(예: 6자리)로 문자열 생성
    const humanFixed = human.toFixed(decimals); // 예: "5000000000.000000"

    console.log('Human Balance:', humanFixed);

    // === 여기서 DB 저장 시에도 문자열 그대로 저장하세요 ===
    // await saveBalanceToDB(userId, humanFixed); // 예시

    return res.status(200).send({ result: 'success', balance: humanFixed, decimals });
  } catch (error) {
    console.error('잔액 조회 중 오류:', error);
    return res.status(500).send({ result: 'error', message: 'Failed to fetch token balance', error: error.message });
  }
});

// router.post('/getAddressTokenBalance', async function(req, res, next) {
//   const userAddress = req.body.address;

//     // TronWeb 인스턴스 생성
//     const tronWeb = new TronWeb(fullNode, solidityNode, eventServer);

//   if (!userAddress || userAddress.trim() === '' || !tronWeb.isAddress(userAddress)) {
//     // 주소가 없거나 빈 값이거나 잘못된 형식일 경우 에러 메시지 반환
//     return res.status(400).send({ result: 'error', message: 'Invalid address provided' });
//   }

//   try {
//     // 계약 인스턴스 가져오기
//     const contract = await tronWeb.contract().at(EVCtokenContractAddress);
//     tronWeb.setAddress(userAddress);

//     // 사용자 주소의 잔액을 가져옵니다.
//     let balance = 0;
//     try {
//       balance = await contract.methods.balanceOf(userAddress).call();
//       console.log('Raw Balance (in Sun):', balance.toString());
//     } catch (error) {
//       console.error('잔액 조회 중 오류 발생:', error.response?.data || error.message);
//       throw error; // 에러 다시 던지기
//     }

//     // 소수점 단위를 적용하여 변환 (예: 소수점 자릿수 18)
//     const decimals = 6; // 토큰의 소수점 자릿수
//     const decimalBalance = new BigNumber(balance.toString()).dividedBy(new BigNumber(10).pow(decimals)).toString();

//     console.log('LOTT Balance:', decimalBalance);

//     // 성공 응답 반환
//     res.status(200).send({ result: 'success', balance: decimalBalance });
//   } catch (error) {
//     console.error('잔액 조회 중 오류 발생:', error);
//     res.status(500).send({ result: 'error', message: 'Failed to fetch token balance', error: error.message });
//   }
// });



router.post('/transfer', async function(req, res, next) {
  const user_srl =req.body.user_srl;
  const user_id =req.body.user_id;
  const senderAddress =req.body.from_address;
  const receiverAddress =req.body.to_address;
  const token_name =req.body.token_name;
  const amount =req.body.amount;
  // const privateKey = req.body.key;
  // 유효성 검사
  if (!user_id || !user_srl || !senderAddress || !receiverAddress || isNaN(amount) || amount <= 0) {
    return res.status(400).send({ result: 'error', message: 'Invalid input parameters' });
  };

  const email = req.body.email;
  const result = await checkUser(user_id , email);
  if(result[0]['block'] == 'YES'){
    return res.status(200).send({result: 'error', message: '잠겨있어 전송할수 없습니다.'});
  }

  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();

  try {
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey,
    });

    // 전송량을 Sun 단위로 변환 (1 TRX = 1,000,000 Sun)
    const trxAmount = parseInt(amount) * 1_000_000;

    // 트랜잭션 생성
    const transaction = await tronWeb.transactionBuilder.sendTrx(receiverAddress, trxAmount, senderAddress);

    // 트랜잭션 서명
    const signedTx = await tronWeb.trx.sign(transaction, privateKey);

    // 트랜잭션 전송
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    // console.log('Transaction Result:', result);

    if (!result || !result.result) {
      throw new Error('Transaction failed. Details: ' + JSON.stringify(result));
    }

    // 트랜잭션 기록
    const historyData = {
      token_name: token_name,
      user_srl: user_srl,
      user_id: user_id,
      from_address: senderAddress,
      to_address: receiverAddress,
      amount: amount,
      usedFee: 0, // 실제 사용된 Fee는 이후 확인하여 업데이트 가능
      IsExternalTrade: 'true',
      transactionHash: result.txid,
    };
// console.log(historyData);
    try {
      insertDB(`${token_name}_history`, historyData, (error, result) => {
        if (error) {
          console.error('Database insert error:', error);
          return res.status(500).send({ result: 'error', message: 'Failed to save transaction history' });
        }
        return res.status(200).send({ result: 'success', transaction: result });
      });
    } catch (dbError) {
      console.error('Database insert error:', dbError);
      return res.status(500).send({ result: 'error', message: 'Failed to save transaction history' });
    }

  } catch (error) {
    console.error('Transaction Error:', error);
    res.status(500).send({ result: 'error', message: 'Failed to transfer TRX', error: error.message });
  }
});
router.post('/transferToken', async function (req, res) {
  const { user_id, user_srl, token_name, from_address: senderAddress, to_address: receiverAddress, amount } = req.body;

  if (!user_id || !user_srl || !token_name || !senderAddress || !receiverAddress || isNaN(amount) || amount <= 0) {
    return res.status(400).send({ result: 'error', message: 'Invalid input parameters' });
  }

  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8').trim();
  // const privateKey = decryptPrivateKey(key);

  try {
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey,
    });

    const tokenContractAddress = EVCtokenContractAddress;
    const decimals = 6;
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
      insertDB(`${token_name.toUpperCase()}_history`, historyData, (error) => {
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


async function makeKeyFile(user_id, content, fileName) {
  const dirPath = path.join('./user', String(user_id), 'TRON');

  // 디렉토리 생성(없으면)
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 }); // 디렉토리 권한 최소화
    } catch (err) {
      console.error('디렉토리 생성 중 오류:', err);
      throw err;
    }
  }

  // 파일 경로(경로 탈출 방지)
  const safeName = path.basename(fileName);
  const filePath = path.join(dirPath, safeName);

  // 존재하면 실패(EEXIST) → 덮어쓰기 방지
  try {
    fs.writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
    console.log('파일이 성공적으로 생성되었습니다.');
    return 'SUCCESS';
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error('파일이 이미 존재합니다. 덮어쓰지 않습니다:', filePath);
      // 필요하면 여기서 'EXISTS'를 리턴하거나 throw로 상위에서 분기 처리
      return 'EXISTS';
      // 또는: throw new Error('Key file already exists');
    }
    console.error('파일 쓰기 중 오류:', err);
    throw err;
  }
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
    const decimals = 6;
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
    const decimals = 6;
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

  const decimals = 6;
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

  const decimals = 6;
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
    var coinList = ["TRON","LOTT"];
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
    var coinList = ["TRON","LOTT"];
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

// 스테이킹 테스트(확인 완료)
router.post('/staking', async function (req, res) {
  // const user_id = "test2";
  // const freezeAmount = 5; // 스테이킹할 금액 (5 TRX = 5,000,000 Sun)
  const user_id = req.body.user_id;
  const freezeAmount = req.body.amount; // 스테이킹할 금액 (5 TRX = 5,000,000 Sun)
  // const resourceType = 'ENERGY'; // 리소스 타입
  const resourceType = req.body.stakingType; // 리소스 타입
  const address = req.body.address;
  const privateKeyPath = `./user/${user_id}/TRON/privateKey`;

  try {
    // Private Key 읽기 및 정리
    let privateKey = fs.readFileSync(privateKeyPath, 'utf8').trim();
    console.log("Raw private key:", privateKey);

    // 개인 키 유효성 검사
    if (!/^([A-Fa-f0-9]{64})$/.test(privateKey)) {
      throw new Error("Invalid private key format. Must be a 64-character hex string.");
    }

    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey: privateKey
    });

    // 잔액 확인
    const balance = await tronWeb.trx.getBalance(address);
    console.log("Account balance (SUN):", balance);

    if (balance < freezeAmount) {
      throw new Error("Insufficient balance for staking.");
    }

    // Freeze Transaction 생성
    console.log('Creating freeze transaction...');
    // const freezeTx = await tronWeb.trx.freezeBalance(freezeAmount, freezeDays, resourceType, address ,address);
      const freezeTx = await tronWeb.transactionBuilder.freezeBalanceV2(tronWeb.toSun(freezeAmount), resourceType, address);
      console.log(freezeTx);
      // {
      //   visible: false,
      //   txID: 'f0b6922ad8f9464ef5bfd51f28f730e7c660c406e5f7bdbeabe556a0e0916754',
      //   raw_data_hex: '0a021871220857cb9a40baa7331d40989fe48eb7325a5a080b12560a32747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e467265657a6542616c616e6365436f6e747261637412200a154185d2ddc924c32bbb78318b5895492ae6d55f166210c096b1021803500170b8cae08eb732',
      //   raw_data: {
      //     contract: [ [Object] ],
      //     ref_block_bytes: '1871',
      //     ref_block_hash: '57cb9a40baa7331d',
      //     expiration: 1732781871000,
      //     timestamp: 1732781811000
      //   }
      // }
      console.log("Freeze transaction created:", freezeTx);

      const signedFreezeTx = await tronWeb.trx.sign(freezeTx, privateKey);
      console.log("Transaction signed:", signedFreezeTx);
  
      const freezeResult = await tronWeb.trx.sendRawTransaction(signedFreezeTx);
      console.log('Energy Staking Result:', freezeResult);
      stakingInsert();
  
      res.status(200).json({ success: true, result: freezeResult });

  } catch (error) {
    console.error('Staking Error:', error.message || error);
    res.status(500).json({ success: false, error: error.message || 'Unknown error', details: error });
  }
});


//계정 스테이킹 정보 확인
router.get('/stakingtest2', async function (req, res) {
  const user_id = "test2";
  const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";

  const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': tronapikey },
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

  // 무료 대역폭 출력
  const availableFreeNet = resources.freeNetLimit || 0;

  // 네트워크 전체 대역폭 및 에너지 출력
  const totalNetLimit = resources.TotalNetLimit || 0;
  const totalEnergyLimit = resources.TotalEnergyLimit || 0;

  // 결과 출력
    console.log('Account Resources:', resources);
  console.log('Available Free Bandwidth:', availableFreeNet);
  console.log('Total Network Bandwidth Limit:', totalNetLimit);
  console.log('Total Network Energy Limit:', totalEnergyLimit);


  // 계정에서 사용 가능한 에너지와 대역폭 정보 출력
  console.log('Available Energy:', resources.EnergyLimit - resources.EnergyUsed);
  console.log('Available Bandwidth:', resources.netLimit - resources.netUsed);
  // 결과 반환
  res.status(200).json({
    success: true,
    freeNetLimit: availableFreeNet,
    totalNetLimit: totalNetLimit,
    totalEnergyLimit: totalEnergyLimit,
    fullResources: resources
  });
  

});
//스테이킹 금액 확인
router.get('/checkStaking', async function (req, res) {
  const user_id = "test2";
  const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";

  try {
    const privateKey = fs.readFileSync(`./user/${user_id}/TRON/privateKey`, 'utf8');

    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      headers: { 'TRON-PRO-API-KEY': tronapikey },
      privateKey: privateKey
    });

    console.log('Fetching account details...');
    const account = await tronWeb.trx.getAccount(address);

    // frozenV2 정보에서 스테이킹 금액 확인
    const frozenV2 = account.frozenV2 || [];
    let stakedForBandwidth = 0;
    let stakedForEnergy = 0;
console.log(frozenV2);
    if (frozenV2.length > 0) {
      frozenV2.forEach(item => {
        if (item.amount && item.amount !== 0) {
          if (item.type === 'ENERGY') {
            stakedForEnergy += item.amount; // 에너지에 스테이킹된 금액
          } else if (item.type === 'TRON_POWER') {
            stakedForBandwidth += item.amount; // 대역폭에 스테이킹된 금액
          }
        }
      });
    }

    console.log('Staked for Bandwidth (TRX):', stakedForBandwidth / 1e6);
    console.log('Staked for Energy (TRX):', stakedForEnergy / 1e6);

    // 결과 반환
    return res.status(200).json({
      success: true,
      stakedForBandwidth: stakedForBandwidth / 1e6, // TRX 단위
      stakedForEnergy: stakedForEnergy / 1e6, // TRX 단위
      accountDetails: account
    });
  } catch (error) {
    console.error('Error fetching staking info:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

//호출 비용 확인
router.get('/stakingtest4', async function (req, res) {
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
    } else if (coin_name === 'LOTT') {
      // TRC-20 토큰 전송 에너지 계산
      console.log("Estimating energy for TRC-20 transfer...");

      const contract = await tronWeb.contract().at(EVCtokenContractAddress);

      const functionSelector = 'transfer(address,uint256)';
      const decimals = 6;
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
  // const user_id = "test2";
  // const address = "TNAoUphvyDWZiVnBjivZzoeJZLKUpqHj4D";
  // getStakingAmount(user_id, address);
  // var user_token_account = {
  //   user_srl: '21',
  //   wallet: 'TRON',
  //   token_name: 'TRON',
  //   address: 'TPhgM8yhenjtsikjPK1F7W3HAMFo7vWFgj'
  // };
  // await updateWalletAccount(user_token_account, async (error, results) => {
  //   if (error) {
  //     res.status(500).send(error);
  //   }
  // });

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
