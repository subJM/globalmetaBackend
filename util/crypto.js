// import CryptoJS from "crypto-js";
const CryptoJS = require("crypto-js");
const passphrase = "wZrW2vpvDASwgUr2QIs6";

// Private Key 암호화
const encryptPrivateKey = (privateKey) => {
    return CryptoJS.AES.encrypt(privateKey, passphrase).toString();
};

// Private Key 복호화
const decryptPrivateKey = (encryptedPrivateKey) => {
    const bytes = CryptoJS.AES.decrypt(encryptedPrivateKey, passphrase);
    return bytes.toString(CryptoJS.enc.Utf8);
};

// 예시
// const privateKey = "asd";
// const encryptedKey = encryptPrivateKey(privateKey);
// console.log("Encrypted Key:", encryptedKey);

// const decryptedKey = decryptPrivateKey(encryptedKey);
// console.log("Decrypted Key:", decryptedKey);
module.exports = {
  encryptPrivateKey,
  decryptPrivateKey,
};
