var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');


var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var contractRouter = require('./routes/contract');
var tokenRouter = require('./routes/token');
var walletRouter = require('./routes/wallet');
var noticeRouter = require('./routes/notice');
var tronRouter = require('./routes/tron');
var tonRouter = require('./routes/ton');
var lottRouter = require('./routes/lott');
const cors = require('cors');

var app = express();

// view engine setup
// app.set('views', path.join(__dirname, 'views'));
// app.set('view engine', 'jade');
app.use(cors({
  // origin: 'http://1.231.89.30:8080'
  origin: ['http://127.0.0.1:8080', 'http://localhost:8080', '1.234.2.54:8080', 'http://1.234.2.54:8080', "http://evc-w.io", "http://211.45.175.111", "https://lottwallet.org"],
  // origin: ['*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 허용할 HTTP 메서드
  // allowedHeaders: ['Content-Type', 'Authorization'], // 허용할 헤더
  credentials: true // 쿠키나 인증 정보를 포함할 수 있도록 설정
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/contract', contractRouter);
app.use('/token', tokenRouter);
app.use('/wallet', walletRouter);
app.use('/notice', noticeRouter);
app.use('/tron', tronRouter);
app.use('/ton', tonRouter);
app.use('/lott', lottRouter);

// 404
app.use(function (req, res, next) {
  console.log(`Incoming request from: ${req.ip}, URL: ${req.url}`);
  res.status(404).json({ error: 'Not Found', url: req.originalUrl });
});

// Error handler
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Server Error'
  });
});

module.exports = app;
