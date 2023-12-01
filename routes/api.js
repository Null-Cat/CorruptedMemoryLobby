require('dotenv').config()
const express = require('express')
const shell = require('shelljs')
const clc = require('cli-color')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const mariadbPool = require('../utilities/mariadbPool')
const { logTimestamp, getIP, authenticateJWT, hasPerms } = require('../utilities/utilities')

const router = express.Router()

router.get('/', (req, res) => {
  res.send('API Running')
})

router.get('/create', authenticateJWT, (req, res) => {
  if (!hasPerms(['CREATE_LOBBY'], req.user)) {
    console.log(`${logTimestamp} ${clc.red(`${req.user.username} does not have permission to create a lobby`)}`)
    res.sendStatus(403)
    return
  }
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

router.get('/lobbies/id/:id', (req, res) => {
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

router.get('/lobbies/port/:port', (req, res) => {
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

router.post('/login', express.json(), (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT password FROM players WHERE username = ?', [req.body.username])
        .then((rows) => {
          if (rows.length === 0) {
            console.log(`${clc.red(`${logTimestamp} Invalid Username ${req.body.username}`)}`)
            res.sendStatus(404)
            conn.end()
          } else {
            bcrypt
              .compare(req.body.password, rows[0].password)
              .then((passwordCompareResult) => {
                if (passwordCompareResult) {
                  console.log(`${logTimestamp} Login for ${clc.green(req.body.username)}`)
                  conn.query('UPDATE players SET lastLogin = NOW() WHERE username = ?', [req.body.username]).catch((err) => {
                    console.error(err.message)
                  })
                  conn
                    .query('SELECT 1 FROM sessions WHERE username = ?', [req.body.username])
                    .then((response) => {
                      if (response.length > 0) {
                        conn.query('UPDATE sessions SET ip = ? WHERE username = ?', [getIP(req), req.body.username]).catch((err) => {
                          console.error(err.message)
                        })
                      } else {
                        conn.query('INSERT INTO sessions VALUES (?, ?, ?)', [crypto.randomUUID(), req.body.username, getIP(req)]).catch((err) => {
                          console.error(err.message)
                        })
                      }
                    })
                    .catch((err) => {
                      console.error(err.message)
                    })
                  const token = jwt.sign({ username: req.body.username }, process.env.JWT_SECRET, { expiresIn: '1d' })
                  res.send({ token: token })
                  conn.end()
                } else {
                  console.log(`${clc.red(`${logTimestamp} Invalid Password for ${req.body.username}`)}`)
                  res.sendStatus(401)
                  conn.end()
                }
              })
              .catch((err) => {
                console.error(err.message)
                res.sendStatus(500)
                conn.end()
              })
          }
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

router.post('/logout', express.json(), authenticateJWT, (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('DELETE FROM sessions WHERE username = ?', [req.user.username])
        .then((rows) => {
          console.log(`${logTimestamp} Logout for ${req.user.username}`)
          res.sendStatus(200)
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

router.post('/register', express.json(), (req, res) => {
  defaultPerms = { perms: ['CREATE_LOBBY', 'JOIN_LOBBY', 'DELETE_ACCOUNT'] }
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT 1 FROM players WHERE username = ?', [req.body.username])
        .then((rows) => {
          if (rows.length > 0) {
            console.log(`${clc.red(`${logTimestamp} Username ${req.body.username} Already Exists`)}`)
            res.sendStatus(409)
            conn.end()
          } else {
            bcrypt
              .genSalt(10)
              .then((salt) => {
                return bcrypt.hash(req.body.password, salt)
              })
              .then((hash) => {
                conn
                  .query('INSERT INTO players VALUES (?, ?, ?, ?, ?, NOW())', [crypto.randomUUID(), req.body.username, hash, defaultPerms, null])
                  .then((response) => {
                    console.log(`${logTimestamp} Registration for ${req.body.username}`)
                    res.sendStatus(200)
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
                console.error(err.message)
                res.sendStatus(500)
                conn.end()
              })
          }
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

router.delete('/delete', authenticateJWT, (req, res) => {
  if (!hasPerms(['DELETE_ACCOUNT'], req.user)) {
    console.log(`${logTimestamp} ${clc.red(`${req.user.username} does not have permission to delete their account`)}`)
    res.sendStatus(403)
    return
  }
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('DELETE FROM players WHERE username = ?', [req.user.username])
        .then((rows) => {
          console.log(`${logTimestamp} ${req.user.username} Deleted`)
          res.sendStatus(200)
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
