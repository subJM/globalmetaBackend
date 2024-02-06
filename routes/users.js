var express = require('express');
var router = express.Router();
const fs = require('fs');
const path = require('path');

// var { Web3 } = require('web3');
// const PROJECT_ID = process.env.PROJECT_ID;
// const web3 = new Web3(`wss://eth-sepolia.g.alchemy.com/v2/${PROJECT_ID}`);
require('dotenv').config();

const hre = require("hardhat");

const { insertDB, selectUserDB } = require('../mysql.js');

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});


router.get('/account/create', function(req, res, next) {
  // const account = web3.eth.accounts.create();
  const account = hre.ethers.Wallet.createRandom();
  console.log(account);
  res.send('Web3 Create Account');
});

router.post('/account/signin', async function(req, res, next) {
  console.log(req.body);
  const user_id = req.body.user_id;
  try {
    await insertDB('users', req.body, async (error, results) => {
      if (error) {
        res.status(500).send('서버 오류 발생');
      } else {
        // const account = web3.eth.accounts.create();
        const account = hre.ethers.Wallet.createRandom();
        console.log(account);

        await makeKeyFile(user_id, account.address,'address');
        await makeKeyFile(user_id, account.privateKey,'privateKey');

        var user_account ={};
        user_account.user_srl = results.insertId;
        user_account.wallet = 'ETH';
        user_account.address = account.address;
        
        await insertDB('walletinfo', user_account, async (error, results) => {
          if (error) {
            console.log(error);
            res.status(500).send('월렛 생성 오류');
          }else {
            console.log('월렛 생성됨');
            res.status(201).send(`사용자 추가됨: ${results.insertId}`);
          }}
        );
     
      }}
    );
  } catch (error) {
    console.log('error: ' + error);
  }
});

router.post('/account/login', async function(req, res, next) {
  console.log(req.body);

  try {
    await selectUserDB('users', req.body, (error, results) => {
      if (error) {
        console.log(error);
        res.status(500).send('서버 오류 발생');
      } else {
        res.status(201).send(`success`);
      }}
    );
    
  } catch (error) {
    console.log('error: ' + error);
  }
});

router.post('/getAddress' , async function (req, res) {
  const user_id = req.body.user_id;
  const address = await fs.readFileSync(`./user/${user_id}/address`, 'utf8');
   res.status(201).send(address);  
});

router.post('/getAddressBalance', async (req, res) => {
  const address = req.body.address;
  var result = await getAddressBalance(address);
  console.log('result :' + result);
  res.status(201).send(result);
});


async function makeKeyFile(user_id,content,fileName){
  const isExists = fs.existsSync(`/user/${user_id}`);
  if(!isExists){
    await fs.mkdir(`./user/${user_id}`, { recursive: true }, (err) =>{
      console.error(err);
      return;
    });
  }
  fs.writeFile(`./user/${user_id}/${fileName}`, content, (err) => {
      if (err) {
          console.error('파일 쓰기 중 오류 발생:', err);
          return;
      }
      console.log('파일이 성공적으로 생성되었습니다.');
      return "SUCCESS";
  });
}

async function getAddressBalance(address) {
  try {
    //ethers로 잔고 가져오기
    const provider = new hre.ethers.AlchemyProvider('sepolia',process.env.ALCHEMY_PRIVATE_KEY);
    const balance = await provider.getBalance(address);
    const balanceEther = hre.ethers.formatEther(balance);
    // console.log(`The balance of address ${address} is: ${balanceEther} ETH`);

    //web3로 잔고 가져오기
    // // Get the balance from the blockchain
    // const balanceWei = await web3.eth.getBalance(address);
    // // Convert the balance from Wei to Ether
    // const balanceEther = web3.utils.fromWei(balanceWei, 'ether');
    
    return Number(balanceEther).toFixed(3);
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
