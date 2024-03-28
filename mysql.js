const mysql = require('mysql2');
require('dotenv').config();

// MySQL 데이터베이스 연결 설정
const createConnection = () => {
    return mysql.createConnection({
        host: process.env.HOST,
        port: process.env.MYSQLPORT,
        user: process.env.USERID,
        password: process.env.PASSWORD,
        database: process.env.DATABASE,
        timezone : process.env.TIMEZONE,
    });
};

const loginDB = async (where, callback) => {
    // 연결 시작
    const connection = createConnection();
    connection.connect();

    const query = `SELECT * FROM users WHERE user_id = ? AND password = ?`;
    connection.query(query, [where.user_id, where.password], (error, results, fields) => {
        callback(error ,results);
        // 연결 종료
        connection.end();
    });
}

const insertDB = async (table, setData, callback) => {
    // 연결 시작
    const connection = createConnection();
    connection.connect();

 // 테이블이 존재하는지 확인하는 쿼리
 const checkTableQuery = `SHOW TABLES LIKE '${table}'`;
 connection.query(checkTableQuery, (error, results, fields) => {
     if (error) {
         callback(error, null);
         // 연결 종료
         connection.end();
         return;
     }

     // 테이블이 존재하지 않으면 생성
     if (results.length === 0) {
         const createTableQuery = `CREATE TABLE ${table} (
            id int NOT NULL AUTO_INCREMENT,
            token_name varchar(45) NOT NULL,
            user_srl int NOT NULL,
            user_id varchar(45) NOT NULL,
            from_address varchar(100) NOT NULL,
            to_address varchar(100) NOT NULL,
            amount decimal(50,18) NOT NULL,
            usedFee decimal(50,18) NOT NULL,
            IsExternalTrade varchar(45) NOT NULL DEFAULT 'no',
            transactionHash varchar(255) NOT NULL,
            create_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB;
          `;
         connection.query(createTableQuery, (createError, createResults, createFields) => {
             if (createError) {
                 callback(createError, null);
                 // 연결 종료
                 connection.end();
                 return;
             }
             
             // 테이블 생성 후 INSERT 쿼리 실행
             const insertQuery = `INSERT INTO ${table} SET ?`;
             connection.query(insertQuery, setData, (insertError, insertResults, insertFields) => {
                 callback(insertError, insertResults);
                 // 연결 종료
                 connection.end();
             });
         });
     } else {
         // 테이블이 이미 존재하면 바로 INSERT 쿼리 실행
         const insertQuery = `INSERT INTO ${table} SET ?`;
         connection.query(insertQuery, setData, (insertError, insertResults, insertFields) => {
             callback(insertError, insertResults);
             // 연결 종료
             connection.end();
         });
     }
 });
}

const selectHistoryDB = async () => {
    const connection = createConnection();
    connection.connect();

    const query = `SELECT a.user_id, username, email, wallet,address FROM ${table} a join walletinfo b on a.id=b.user_srl  WHERE user_id = ? AND password = ?`;
    connection.query(query, [WHERE.user_id , WHERE.password], (error, results, fields) => {
        callback(error ,results);
        // 연결 종료
        connection.end();
    });
};

const selectUserDB = async (table, where, callback) => {
    // 연결 시작
    const connection = createConnection();
    connection.connect();

    const query = `SELECT * FROM ${table} WHERE user_id = ?`;
    connection.query(query, where, (error, results, fields) => {
        callback(error ,results);
        // 연결 종료
        connection.end();
    });
}

const insertContractDB = async (table, contract_info, callback) => {
    const connection = createConnection();
    connection.connect();
    // INSERT 쿼리 작성 및 실행
    const query = `INSERT INTO ${table} SET ?`;
    connection.query(query, contract_info, (error, results, fields) => {
        callback(error ,results);
        connection.end();
    });
};

const DB_query = async function(query, callback){
    const connection = createConnection();
    connection.connect();
    
    connection.query(query, token_info , (error, results, fields) => {
        callback(error ,results[0]);
        connection.end();
    });
}


const findTokenContractAddress = async function (token_info, callback){
    const connection = createConnection();
    connection.connect();
    // INSERT 쿼리 작성 및 실행
    const query = `SELECT * FROM globalmeta.contract WHERE ? ;`;
    connection.query(query, token_info , (error, results, fields) => {
        callback(error ,results[0]);
        connection.end();
    });
}

const getTokenList = async (user_srl, callback) => {
    const connection = createConnection();
    connection.connect();
    // INSERT 쿼리 작성 및 실행
    const query = `SELECT Id, wallet , token_name FROM globalmeta.walletinfo WHERE user_srl = ?;`;
    connection.query(query, user_srl ,(error, results, fields) => {
        callback(error ,results);
        connection.end();
    });
}

const getWalletBalance =  async (user_srl, callback) => {
    const connection = createConnection();
    connection.connect();
    const query = `SELECT * FROM globalmeta.walletinfo where user_srl = ? ;`;
    connection.query(query, user_srl, (error, results, fields) => {
        callback(error ,results);
        connection.end();
    });
} 

const checkAddress = async (checkForm, callback) => {
    const connection = createConnection();
    connection.connect();
    const query = `SELECT * FROM globalmeta.walletinfo where token_name = ? AND address = ? `;

    const queryParams = [checkForm.token_name, checkForm.to_address];
    connection.query(query, queryParams, (error, results, fields) => {
        console.log("results : ",results);
        callback(results);
        connection.end();
    });
}

const updateWalletInfo = async ( sign, user_srl, token_name, amount, callback) => {
    const connection = createConnection();
    connection.connect();

    var type = "";
    // type is plus or minus sign
    if(sign == "plus"){
        type = '+';
    }else{
        type = '-';
    }

    const query = `UPDATE globalmeta.walletinfo 
    SET balance = balance ${type} ${amount} 
    WHERE user_srl = "${user_srl}" AND token_name = "${token_name}"; `;

    console.log("updateWalletInfo" , query);
    connection.query(query, (error, results, fields) => {
        callback(results);
        connection.end();
    });
};

const updateWallet = (user_srl , token_name , balance, callback) => {
    const connection = createConnection();
    connection.connect();

    const query = `UPDATE globalmeta.walletinfo SET balance = ${balance} WHERE user_srl = ${user_srl} AND token_name = '${token_name}' ;
    `;

    console.log("updateWalletInfo" , query);
    connection.query(query, (error, results, fields) => {
        callback(results);
        connection.end();
    });

};

const getHistory = (user_srl, token_name , address , callback) => {
    const connection = createConnection();
    connection.connect();
    const query = `SELECT 
    *,
    CASE 
        WHEN to_address = '0x687087daFd0F7849e0Fe0992f474c5790e483B9d' THEN 'receive'
        ELSE 'send'
    END AS action
    FROM globalmeta.${token_name}_history
    WHERE token_name = '${token_name}'
    AND (from_address = '${address}' 
    OR to_address = '${address}')
    ORDER BY create_at DESC;`;
    console.log("getHistory" , query);
    connection.query(query, (error, results, fields) => {
        callback(results);
        connection.end();
    });
}

const sendQuestion = (setData , callback) => {
    const connection = createConnection();
    connection.connect();
    // 테이블 생성 후 INSERT 쿼리 실행
    const insertQuery = `INSERT INTO globalmeta.suggestions SET ?`;
    connection.query(insertQuery, setData, (insertError, insertResults, insertFields) => {
        callback(insertError, insertResults);
        // 연결 종료
        connection.end();
    });
};

const getNotice = (callback) => {
    const connection = createConnection();
    connection.connect();
    // 테이블 생성 후 INSERT 쿼리 실행
    const query = `SELECT * FROM globalmeta.notice;`;
    connection.query(query, (error, results, insertFields) => {
        callback(error, results);
        // 연결 종료
        connection.end();
    });
};

const searchNotice = ( searchData , callback) => {
    const connection = createConnection();
    connection.connect();
    // 테이블 생성 후 INSERT 쿼리 실행
    const query = `SELECT * FROM globalmeta.notice where title LIKE '%${searchData}%' or content LIKE  '%${searchData}%';`;
    console.log('query: ',query);
    connection.query(query, (error, results, insertFields) => {
        callback(error, results);
        // 연결 종료
        connection.end();
    });
};

const getNoticeDetail = ( noticeId , callback) => {
    const connection = createConnection();
    connection.connect();
    // 테이블 생성 후 INSERT 쿼리 실행
    const query = `SELECT * FROM globalmeta.notice where id = ?`;
    connection.query(query, noticeId, (error, results, 
        insertFields) => {
            console.log('getNoticeDetail: ',  results);
        callback(error, results);
        // 연결 종료
        connection.end();
    });
};

// 모듈로 내보내기
module.exports = {
    insertDB,
    selectUserDB,
    insertContractDB,
    findTokenContractAddress,
    selectHistoryDB,
    loginDB,
    getTokenList,
    getWalletBalance,
    checkAddress,
    updateWalletInfo,
    updateWallet,
    getHistory,
    sendQuestion,
    getNotice,
    searchNotice,
    getNoticeDetail,
};