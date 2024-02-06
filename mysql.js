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
    });
};

const insertDB = async (table, setData, callback) => {
    // 연결 시작
    const connection = createConnection();
    connection.connect();

    // INSERT 쿼리 작성 및 실행
    const query = `INSERT INTO ${table} SET ?`;
    connection.query(query, setData, (error, results, fields) => {
        callback(error ,results);
        // 연결 종료
        connection.end();
    });
}

const selectUserDB = async (table, WHERE, callback) => {
    // 연결 시작
    const connection = createConnection();
    connection.connect();

    const query = `SELECT a.user_id, username, email, wallet,address FROM ${table} a join walletinfo b on a.id=b.user_srl  WHERE user_id = ? AND password = ?`;
    connection.query(query, [WHERE.user_id , WHERE.password], (error, results, fields) => {
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

// 모듈로 내보내기
module.exports = {
    insertDB,
    selectUserDB,
    insertContractDB,
    findTokenContractAddress,
};