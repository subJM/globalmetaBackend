var express = require('express');
var router = express.Router();
const fs = require('fs');
const path = require('path');

var { Web3 } = require('web3');
// const PROJECT_ID = process.env.PROJECT_ID;
// const web3 = new Web3(`wss://eth-sepolia.g.alchemy.com/v2/${PROJECT_ID}`);
require('dotenv').config();

const hre = require("hardhat");

const { insertDB, selectUserDB, loginDB, checkUser} = require('../mysql.js');

const { encryptPrivateKey, decryptPrivateKey} = require("../util/crypto.js");

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});


router.get('/account/create', function(req, res, next) {
  // const account = web3.eth.accounts.create();
  const account = hre.ethers.Wallet.createRandom();
  res.send('Web3 Create Account');
});

// var setData = {
//   user_id: user_id,
//   user_name: req.body.user_name,
//   user_email: req.body.user_email,
//   user_password: req.body.user_password,
//   user_phone: req.body.user_phone,
//   user_birth: req.body.user_birth,
//   user_gender: req.body.user_gender,
//   user_profile: req.body.user_profile,
//   user_status: 1,
//   user_created_at: new Date(),
//   user_updated_at: new Date()
// };
router.post('/account/signin', async function (req, res, next) {
  const user_id = req.body.user_id;
  const email = req.body.email;
  try {
    // 유저 아이디 체크
    const result = await checkUser(user_id , email);
    if (result.length > 0) {
      console.log(JSON.stringify(result));
      // 아이디가 이미 존재하면 응답 후 종료
      return res.status(201).send('exist');
    };
    return res.status(201).send('success');
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).send('Internal Server Error');
  }
  // 이더와 LOTT 지갑 생성
  // try {
  //   await insertDB('users', req.body, async (error, results) => {
  //     if (error) {
  //       return res.status(500).send('서버 오류 발생');
  //     } else {
        // const account = hre.ethers.Wallet.createRandom();

        // await makeKeyFile(user_id, account.address, 'address');
        // await makeKeyFile(user_id, account.privateKey, 'privateKey');

        // const user_account = {
        //   user_srl: results.insertId,
        //   wallet: 'ETH',
        //   token_name: 'ETH',
        //   address: account.address,
        // };

        // await insertDB('walletinfo', user_account, async (error, results) => {
        //   if (error) {
        //     console.log(error);
        //     return res.status(500).send(error);
        //   }
        // });

        // const user_lott_account = {
        //   user_srl: results.insertId,
        //   wallet: 'LOTT',
        //   token_name: 'LOTT',
        //   address: account.address,
        // };

        // await insertDB('walletinfo', user_lott_account, async (error, results) => {
        //   if (error) {
        //     console.log(error);
        //     return res.status(500).send(error);
        //   } else {
            // return res.status(201).send('success');
        //   }
        // });
  //     }
  //   });
  // } catch (error) {
  //   console.error('Error:', error);
  //   return res.status(500).send('Internal Server Error');
  // }
});


router.post('/account/login', async function(req, res, next) {
  try {
    await loginDB(req.body, (error, results) => {
      if (error) {
        throw error;
      } else {
        console.log('selectUserDB',results);
        res.status(201).send({result: 'success', data: results});
      }}
    );
    
  } catch (error) {
    console.log('error: ' + error);
  }
});

//이더 지갑주소 가져오기
router.post('/getEthAddress' , async function (req, res) {
  // const user_id = req.body.user_id;
  // const token_name = req.body.token_name;
  // console.log(req.body);
  // const key = decryptPrivateKey(req.body.key);
  // const address = await fs.readFileSync(`./user/${user_id}/ETH/address`, 'utf8');
  // const web3 = new Web3();
  
  // res.status(201).send(web3.eth.accounts.privateKeyToAddress(key));

  try {
    const user_id = req.body.user_id;
    // 비동기 방식으로 파일 읽기
    const address = fs.readFileSync(`./user/${user_id}/ETH/address`, 'utf8');
    // const address = decryptPrivateKey(key);
    res.status(201).send({ address: address });
  } catch (error) {
    console.error('Error reading address file:', error);
    // 파일을 읽는 중 에러가 발생하면 500 상태 코드를 클라이언트로 전송
    res.status(500).send({ result: 'error', message: 'Failed to read address file' });
    // 또는 next(error)로 에러 처리 미들웨어로 전달
  }
});


router.post('/getAddressBalance', async (req, res) => {
  const address = req.body.address;
  const result = await getAddressBalance(address);
  res.status(201).send({balance: result});
});


// async function makeKeyFile(user_id,content,fileName){
//   const isExists = fs.existsSync(`/user/${user_id}`);
//   if(!isExists){
//     await fs.mkdir(`./user/${user_id}`, { recursive: true }, (err) =>{
//       console.error(err);
//       return;
//     });
//   }
//   fs.writeFile(`./user/${user_id}/${fileName}`, content, (err) => {
//       if (err) {
//           console.error('파일 쓰기 중 오류 발생:', err);
//           return;
//       }
//       console.log('파일이 성공적으로 생성되었습니다.');
//       return "SUCCESS";
//   });
// }


//이더리움 잔고 가져오기
async function getAddressBalance(address) {
  try {
    //ethers로 잔고 가져오기
    // const provider = new hre.ethers.AlchemyProvider('sepolia',process.env.ALCHEMY_PRIVATE_KEY);
    const provider = new hre.ethers.AlchemyProvider('mainnet',process.env.ALCHEMY_PRIVATE_KEY);
    // const provider = new hre.ethers.AlchemyProvider('mainnet',process.env.ALCHEMY_PRIVATE_KEY);
    const balance = await provider.getBalance(address);
    const balanceEther = hre.ethers.formatEther(balance);
    return balanceEther;
  } catch (error) {
    console.error('Error fetching the balance:', error);
  }
}

// 파일 옮기기
// 키와 유저에 대한 정보를 한곳에 두는건 위험할수 있으니 추후 분리가 필요함
async function moveFile(user_name,file_name) {
  const oldPath = `/source/${file_name}`;
  const newPath = `/user/${user_name}/${file_name}`;
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  return fs.rename(oldPath, newPath,  function(err) {
    if (err) {
        console.error('Error occurred while moving the file:', err);
    } else {
        console.log('File moved successfully');
    }
  });
}


module.exports = router;
