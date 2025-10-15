module.exports = {
  apps: [{
    name: 'globalmeta-api',
    script: 'bin/www',
    cwd: '/var/www/globalmetaBackend',
    exec_mode: 'cluster',
    instances: 1,               // 우선 1개로 확인 후 scale
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',        // ★ IPv4 고정 (중요)
      PORT: 3000
    }
  }]
}
