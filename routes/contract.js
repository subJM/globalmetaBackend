var express = require('express');
var router = express.Router();

var fs = require('fs');

// const { exec } = require('child_process');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

require('dotenv').config();

const hre = require("hardhat");

const { insertContractDB } = require('../mysql.js');

/* GET home page. */
router.get('/', async function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/test', async function(req, res, next) {

});

router.post('/deploy', async (req, res) => {
    const contract_info = req.body;
    const user_id = req.body.user_id;

    try {
        // console.log('user_id: ' + user_id);
        // console.log('contract_info: ' + contract_info);
        var path = `./contracts/${contract_info.token_name}.sol`;
        const file_exist = fs_Exists(path);
        if(file_exist){
            return res.status(200).send('같은 이름의 토큰이 존재합니다');
        }
        
        //계약서 생성
        var contractResult = await makeTokenContract(contract_info);
        // console.log('contractResult: '+contractResult);


        // 마이그레이션 파일 수정
        var deployFileResult = await makeDeployFile(contract_info);
        // console.log('deployFileResult :', deployFileResult);

        // // 디플로이
        var deployResult = await tokenDeploy(contract_info);
        console.log('tokenDeploy:' + deployResult );
        contract_info.contractAddress = deployResult;
        

        // 계약서 평면화
        // const flatResult = await flatten(contract_info);
        // console.log('flatResult',flatResult);
        
        const contractVerify = await contractCompiler(contract_info, 'sepolia');

        await insertContractDB('contract', contract_info , async (error, results)=>{
            if (error) {
                console.log(error);
                res.status(500).send('서버 오류 발생');
            } else {
                file_move(contract_info)
                res.status(200).send('success');
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Server error');
    }
});


//scripts 기능 파일 생성
async function makeDeployFile(contract_info){
    console.log(contract_info);
    var content = `const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const privateKey = fs.readFileSync('./user/${contract_info.user_id}/privateKey', "utf8"); // 개인 키
    const address = fs.readFileSync('./user/${contract_info.user_id}/address', "utf8");
    const provider = new hre.ethers.JsonRpcProvider(process.env.ALCHEMY_TESTNET_RPC_URL); // JSON RPC 프로바이더
    const wallet = new hre.ethers.Wallet(privateKey, provider); // 개인 키와 연결된 지갑 객체 생성
    
    const ContractFactory = await hre.ethers.getContractFactory("${contract_info.token_name}", wallet); // 지갑을 사용하여 계약 팩토리 생성
    const contract = await ContractFactory.deploy(address); // 계약 배포
    
    await contract.waitForDeployment();

    console.log("Contract target:", contract.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
`;
    try {

        fs.writeFile(`./scripts/${contract_info.token_name}_deploy.js`, content, function (err, data) {
            if (err) {
                console.error('파일 쓰기 중 오류 발생:', err);
                return 'fail';
            }
            return "success";
        });
    } catch (err) {
        console.error('파일 쓰기 중 오류 발생:', err);
        return err.message;
    }
}

//파일 생성
async function makeTokenContract(contract_info){
    var content = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";

contract ${contract_info.token_name} is ERC20, ERC20Burnable, ERC20Pausable, Ownable, ERC20Permit, ERC20FlashMint {
    constructor(address initialOwner)
        ERC20("${contract_info.token_name}", "${contract_info.token_simbol}")
        Ownable(initialOwner)
        ERC20Permit("${contract_info.token_name}")
    {
        _mint(msg.sender, ${contract_info.amount} * 10 ** decimals());
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    // The following functions are overrides required by Solidity.

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
`;
    
fs.existsSync("./contracts/"+contract_info.token_name+".sol",function(a,b){

})
    await fs.writeFile("./contracts/"+contract_info.token_name+".sol", content, (err) => {
        if (err) {
            console.error('파일 쓰기 중 오류 발생:', err);
            return 'fail';
        }
        console.log('파일이 성공적으로 생성되었습니다.');
        return "success";
    });
}

//계약 배포
async function tokenDeploy(contract_info, network="sepolia") {
    try {
        const { stdout, stderr } = await exec(`npx hardhat run ./scripts/${contract_info.token_name}_deploy.js`);
        // const { stdout, stderr } = await exec(`npx hardhat run ./scripts/deploy.js --network localhost`);

        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return stderr;
        }

        // 파싱하여 계약 주소 추출
        const match2 = await stdout.match(/Contract target: (\S+)/);
        if (match2) {
            const contractTarget = match2[1];
            console.log('Contract target:', contractTarget);
            return contractTarget;
        }
    } catch (error) {
        console.error(`exec error: ${error}`);
        return error.message;
    }
}


//파일 평면화
async function flatten(token_info) {
    try {
        const { stdout, stderr } = await exec(`npx hardhat flatten ./contracts/${token_info.token_name}.sol > ./contracts/${token_info.user_id}/${token_info.token_name}_flat.sol`);

        if (stdout) {
            console.log(`stdout: ${stdout}`);
            return 'success';
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return stderr;
        }
    } catch (error) {
        console.error(`exec error: ${error}`);
        return error.message;
    }
}

async function contractCompiler(contract_info , network='sepolia'){
    // npx hardhat verify --contract contracts/BOB.sol:BOB --network sepolia 0x32d266C68c1B867E80606fcAF81A05533b4c048a "0x687087daFd0F7849e0Fe0992f474c5790e483B9d"

    try {
        const { stdout, stderr } = await exec(`npx hardhat verify --contract contracts/${contract_info.token_name}.sol:${contract_info.token_name} --network ${network} ${contract_info.contractAddress} "${contract_info.address}"`);

        if (stdout) {
            console.log(`stdout: ${stdout}`);
            return 'success';
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return stderr;
        }
    } catch (error) {
        console.error(`exec error: ${error}`);
        return error.message;
    }

}

//완료된 파일 옮기기
 function file_move(contract_info){
    // 파일을 옮기려는 경로
    const oldPath = `./contracts/${contract_info.token_name}.sol`;
    const newPath = `./MakeContract/${contract_info.user_id}`;
    try {
        fs.mkdir(newPath, { recursive: true }, (err) =>{
            console.error(err);
            return;
        });
        var makeDeployFile = `${newPath}/${contract_info.token_name}.sol`;

        // var num = 1;
        // while (fs_Exists(makeDeployFile)) {
        //     makeDeployFile=`${newPath}/${contract_info.token_name}_${num}.sol`;
        //     num += 1;
        // }
        
        // 파일 옮기기
        fs.rename(oldPath, makeDeployFile, (err) => {
            if (err) throw err;
            console.log('파일이 성공적으로 이동되었습니다.');
        });
    } catch (error) {
        var data = {
            result: 'fail',
            msg: '알수없는 오류 발생'
        }
        return res.status(500).send(data);
    }

}

//파일 존재 여부 체크
function fs_Exists(path){
    var exist =fs.existsSync(path);
    return exist;
}


module.exports = router;
