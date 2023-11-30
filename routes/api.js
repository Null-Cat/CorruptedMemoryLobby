require('dotenv').config()
const express = require('express')
const shell = require('shelljs')
const mariadbPool = require('../utilities/mariadbPool')
const { logTimestamp } = require('../utilities/utilities')

const router = express.Router()

router.get('/', (req, res) => {
  res.send('API Running')
})

router.get('/create', (req, res) => {
  let lobbyID = makeID(5)
  let createdServerPort
  let server
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT id, port FROM lobbies ORDER BY port DESC')
        .then((rows) => {
          let isUnique = false
          let generatedID = lobbyID
          while (!isUnique) {
            const existingID = rows.find((row) => row.id === generatedID)
            if (existingID) {
              generatedID = makeID(5)
            } else {
              isUnique = true
            }
          }
          lobbyID = generatedID
          if (rows.length === 0) {
            createdServerPort = 7777
          } else {
            createdServerPort = rows[0].port + 1
          }

          console.log(`${logTimestamp} Creating Server on Port ${createdServerPort} with ID ${lobbyID}`)
          server = shell.exec(`/home/phro/Server/LinuxArm64Server/CorruptedMemoryServer-Arm64.sh -log -port=${createdServerPort}`, { async: true })
          console.log(`${logTimestamp} Server Created`)
        })
        .then(() => {
          return conn.query('INSERT INTO lobbies value (?, ?, ?)', [lobbyID, createdServerPort, null])
        })
        .then((response) => {
          console.log(response)
          console.log(`${logTimestamp} Database Entry Created for ${lobbyID}`)
          res.send({ lobbyID: lobbyID, port: createdServerPort, pid: server.pid })
          conn.end()
        })
        .catch((err) => {
          //handle error
          console.log(err)
          res.sendStatus(500)
          conn.end()
        })
    })
    .catch((err) => {
      console.log(err)
      res.sendStatus(500)
    })
})

router.get('/lobbies', (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT * FROM lobbies')
        .then((rows) => {
          res.send(rows)
          conn.end()
        })
        .catch((err) => {
          //handle error
          console.log(err)
          res.sendStatus(500)
          conn.end()
        })
    })
    .catch((err) => {
      console.log(err)
      res.sendStatus(500)
    })
})

router.get('/lobbies/:id', (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT port FROM lobbies WHERE id = ?', [req.params.id])
        .then((rows) => {
          if (rows.length === 0) {
            res.sendStatus(404)
          } else {
            res.send(rows)
          }
          conn.end()
        })
        .catch((err) => {
          //handle error
          console.log(err)
          res.sendStatus(500)
          conn.end()
        })
    })
    .catch((err) => {
      console.log(err)
      res.sendStatus(500)
    })
})

router.get('/lobbies/:port', (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT id FROM lobbies WHERE port = ?', [req.params.port])
        .then((rows) => {
          if (rows.length === 0) {
            res.sendStatus(404)
          } else {
            res.send(rows)
          }
          conn.end()
        })
        .catch((err) => {
          //handle error
          console.log(err)
          res.sendStatus(500)
          conn.end()
        })
    })
    .catch((err) => {
      console.log(err)
      res.sendStatus(500)
    })
})

function makeID(length) {
  let result = ''
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

module.exports = router
