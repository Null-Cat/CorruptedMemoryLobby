const mariadb = require('mariadb')
const pool = mariadb.createPool({
  host: '192.168.0.79',
  user: 'cm-client',
  database: 'corruptedmemory',
  password: process.env.DB_PASSWORD,
  connectionLimit: 20
})

module.exports = { pool }
