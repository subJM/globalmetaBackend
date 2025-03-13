const mysql = require('mysql2');
require('dotenv').config();

// MySQL 데이터베이스 연결 설정
// const createConnection = () => {
//     return mysql.createConnection({
//         host: process.env.HOST,
//         port: process.env.MYSQLPORT,
//         user: process.env.USERID,
//         password: process.env.PASSWORD,
//         database: process.env.DATABASE,
//         timezone : process.env.TIMEZONE,
//     });
// };

const pool = mysql.createPool({
    host: process.env.HOST,
    port: process.env.MYSQLPORT,
    user: process.env.USERID,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    timezone: process.env.TIMEZONE,
});
const loginDB = async (where, callback) => {
    pool.getConnection((err, connection) => {
        if (err) {
            callback(err, null);
            return;
        }
        const query = `SELECT * FROM users WHERE user_id = ? AND password = ? order by id desc limit 1`;
        connection.query(query, [where.user_id, where.password], (error, results, fields) => {
            callback(error, results);
            connection.release(); // 연결 반환
        });
    });
};
const insertDB = (table, setData, callback) => {
    return new Promise((resolve, reject) => {
        let callbackCalled = false; // 콜백 중복 호출 방지 플래그

        pool.getConnection((err, connection) => {
            if (err) {
                if (callback && !callbackCalled) {
                    callbackCalled = true;
                    callback(err, null);
                }
                return reject(err);
            }

            const checkTableQuery = `SHOW TABLES LIKE '${table}'`;
            connection.query(checkTableQuery, (error, results) => {
                if (error) {
                    if (callback && !callbackCalled) {
                        callbackCalled = true;
                        callback(error, null);
                    }
                    connection.release();
                    return reject(error);
                }

                const insertData = () => {
                    const insertQuery = `INSERT INTO ${table} SET ?`;
                    connection.query(insertQuery, setData, (insertError, insertResults) => {
                        if (callback && !callbackCalled) {
                            callbackCalled = true;
                            callback(insertError, insertResults);
                        }
                        connection.release();
                        if (insertError) return reject(insertError);
                        resolve(insertResults);
                    });
                };

                if (results.length === 0) {
                    const createTableQuery = `CREATE TABLE ${table} (
                        id int NOT NULL AUTO_INCREMENT,
                        token_name varchar(45) NOT NULL,
                        user_srl int NOT NULL,
                        user_id varchar(45) NOT NULL,
                        type varchar(45) DEFAULT 'withdraw' COMMENT '''withdraw'' , ''deposit''',
                        from_address varchar(100) NOT NULL,
                        to_address varchar(100) NOT NULL,
                        amount decimal(50,18) NOT NULL,
                        usedFee decimal(50,18) NOT NULL,
                        IsExternalTrade varchar(45) NOT NULL DEFAULT 'no',
                        transactionHash varchar(255) NOT NULL,
                        status varchar(45) DEFAULT 'pending' COMMENT '전송 완료:COMPLETE,전송중:PENDING,실패:FAIL',
                        create_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (id)
                    ) ENGINE=InnoDB`;

                    connection.query(createTableQuery, (createError) => {
                        if (createError) {
                            if (callback && !callbackCalled) {
                                callbackCalled = true;
                                callback(createError, null);
                            }
                            connection.release();
                            return reject(createError);
                        }
                        insertData(); // 테이블 생성 후 데이터 삽입
                    });
                } else {
                    insertData(); // 테이블 존재 시 데이터 삽입
                }
            });
        });
    });
};


const selectHistoryDB = async (where, callback) => {
    const query = `SELECT a.user_id, username, email, wallet, address FROM users a 
                   JOIN walletinfo b ON a.id = b.user_srl  
                   WHERE user_id = ? AND password = ?`;
    pool.query(query, [where.user_id, where.password], (error, results) => {
        callback(error, results);
    });
};

const selectUserDB = async (table, where, callback) => {
    const query = `SELECT * FROM ${table} WHERE user_id = ?`;
    pool.query(query, [where.user_id], (error, results) => {
        callback(error, results);
    });
};

const insertContractDB = async (table, contract_info, callback) => {
    const query = `INSERT INTO ${table} SET ?`;
    pool.query(query, contract_info, (error, results) => {
        callback(error, results);
    });
};

const DB_query = async (query, token_info, callback) => {
    pool.query(query, token_info, (error, results) => {
        callback(error, results[0]);
    });
};

const findTokenContractAddress = async (token_info, callback) => {
    const query = `SELECT * FROM globalmeta.contract WHERE ?`;
    pool.query(query, token_info, (error, results) => {
        callback(error, results[0]);
    });
};

const getTokenList = async (user_srl, callback) => {
    const query = `SELECT Id, wallet, token_name FROM globalmeta.walletinfo WHERE user_srl = ?`;
    pool.query(query, [user_srl], (error, results) => {
        callback(error, results);
    });
};

const getWalletBalance = async (user_srl, callback) => {
    const query = `SELECT * FROM globalmeta.walletinfo WHERE user_srl = ?`;
    pool.query(query, [user_srl], (error, results) => {
        callback(error, results);
    });
};

const checkAddress = async (checkForm, callback) => {
    let query = `SELECT * FROM globalmeta.walletinfo WHERE token_name = ? `;
    let queryParams = [checkForm.token_name];  // Always include token_name first
    // Conditionally add additional filters to the query and parameters
    if (checkForm.to_address) {
        query += `AND address = ? `;
        queryParams.push(checkForm.to_address);
    }
    if (checkForm.user_srl) {
        query += `AND user_srl = ? `;
        queryParams.push(checkForm.user_srl);
    }

    // Execute the query
    pool.query(query, queryParams, (error, results) => {
        callback(error, results);
    });
};

const updateWalletInfo = async (sign, user_srl, token_name, amount, callback) => {
    const type = sign === "plus" ? "+" : "-";
    const query = `UPDATE globalmeta.walletinfo 
                   SET balance = balance = ? 
                   WHERE user_srl = ? AND token_name = ?`;
    pool.query(query, [amount, user_srl, token_name], (error, results) => {
        callback(error, results);
    });
};

const updateWallet = async (user_srl, token_name, balance, callback) => {
    const query = `UPDATE globalmeta.walletinfo 
                   SET balance = ? 
                   WHERE user_srl = ? AND token_name = ?`;
    pool.query(query, [balance, user_srl, token_name], (error, results) => {
        callback(error, results);
    });
};

const updateWalletAccount = async (data ,callback) => {

    const query = `UPDATE globalmeta.walletinfo SET address = ? WHERE user_srl = ? and token_name = ? `;
    pool.query(query, [data.address, data.user_srl, data.token_name], (error, results) => {
        callback(error, results);
    });
};

const getHistory = async (user_srl, token_name, address, callback) => {
    const query = `SELECT *,
                   CASE 
                       WHEN to_address = ? THEN 'receive'
                       ELSE 'send'
                   END AS action
                   FROM globalmeta.${token_name}_history
                   WHERE token_name = ? AND (from_address = ? OR to_address = ?)
                   ORDER BY create_at DESC`;
    pool.query(query, [address, token_name, address, address], (error, results) => {
        callback(error, results);
    });
};

const sendQuestion = async (setData, callback) => {
    const insertQuery = `INSERT INTO globalmeta.suggestions SET ?`;
    pool.query(insertQuery, setData, (error, results) => {
        callback(error, results);
    });
};

const getNotice = async (callback) => {
    const query = `SELECT * FROM globalmeta.notice`;
    pool.query(query, (error, results) => {
        callback(error, results);
    });
};

const searchNotice = (searchData, callback) => {
    const query = `SELECT * FROM globalmeta.notice 
                   WHERE title LIKE ? OR content LIKE ?`;
    const queryParams = [`%${searchData}%`, `%${searchData}%`];
    pool.query(query, queryParams, (error, results) => {
        callback(error, results);
    });
};

const getNoticeDetail =async (noticeId, callback) => {
    const query = `SELECT * FROM globalmeta.notice WHERE id = ?`;
    pool.query(query, [noticeId], (error, results) => {
        callback(error, results);
    });
};

// 지갑 송금내역
const getAddressSendHistory = async (data, callback) => {
    // 화이트리스트로 테이블 이름 검증
    const allowedCoins = ["BTC", "ETH", "TRX", "TRON", "EVC", "LOTT"]; // 허용된 코인 이름 리스트
    if (!allowedCoins.includes(data.coin_name)) {
      return callback(new Error("Invalid coin_name provided"), null);
    }
  
    // SQL 쿼리 작성
    const query = `
        SELECT * 
        FROM globalmeta.${data.coin_name}_history
        WHERE user_srl = ? 
            AND user_id = ?
            AND from_address = ?
            AND type = ?
        ORDER BY create_at DESC
        LIMIT ?;
    `;
  
    // 쿼리 실행
    pool.query(
        query,
        [data.user_srl, data.user_id, data.address, data.type ,data.limit || 5], // 리미트 기본값을 5로 설정
        (error, results) => {
            if (error) {
                console.error("Database Query Error:", error);
                return callback(error, null);
            }
            callback(null, results);
        }
    );
};

const getAllHistory = async (token_name, callback) => {
    const query = `SELECT *
                   FROM globalmeta.${token_name}_history
                   WHERE status != "complete" AND status != "failed"`;
    pool.query(query, [], (error, results) => {
        // console.log(results);
        callback(error, results);
    });
};

//hisotry 테이블 상태 업데이트
const historyUpdate = async (history, callback) => {
    let query = `UPDATE globalmeta.${history.coin_name}_history SET status = ?`;
    const params = [history.status];
    // usedFee가 유효한 경우 추가
    if (history.usedFee !== undefined && history.usedFee >= 0) {
      query += `, usedFee = ?`;
      params.push(history.usedFee);
    }
    query += ` WHERE transactionHash = ?`;
    params.push(history.transactionHash);
    pool.query(query, params, (error, results) => {
      callback(error, results);
    });
  };
  
// UPDATE globalmeta.tron_history SET status = "complete" WHERE ("id" = ?)
//hisotry 오류난것 삭제
const historyDelete = async (history, callback) => {
    // console.log(history);
    const query = `DELETE FROM globalmeta.${history.coin_name}_history WHERE transactionHash = ? ;
`;
    pool.query(query, [history.status , history.transactionHash], (error, results) => {
        callback(error, results);
    });
};
const checkUser = (user_id, user_email) => {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM globalmeta.users WHERE user_id = ? or email = ?`;
    pool.query(query, [user_id, user_email], (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
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
    getAddressSendHistory,
    getAllHistory,
    historyUpdate,
    historyDelete,
    checkUser,
    updateWalletAccount,
};