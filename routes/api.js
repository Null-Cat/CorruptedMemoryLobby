require('dotenv').config()
const express = require('express')
const shell = require('shelljs')
const clc = require('cli-color')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const mariadbPool = require('../utilities/mariadbPool')
const { logTimestamp, getIP, authenticateJWT, hasPerms, io } = require('../utilities/utilities')

const router = express.Router()

router.get('/', (req, res) => {
  res.send('API Running')
})

router.post('/create', authenticateJWT, express.json(), async (req, res) => {
  req.body.maxPlayers = clamp(parseInt(req.body.maxPlayers), 2, 4)
  if (!(await hasPerms(['CREATE_LOBBY'], req.user))) {
    res.sendStatus(403)
    return
  }
  let lobbyID = makeID(5)
  let createdServerPort
  let ownerGUID
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT guid FROM players WHERE lobbyid IS NULL AND username = ?', [req.user.username])
        .then((lobbyIDForUserRows) => {
          if (lobbyIDForUserRows.length > 0) {
            console.log(`${logTimestamp} ${clc.bold(req.user.username)} ${clc.red('Already in a Lobby')}`)
            res.sendStatus(409)
            conn.end()
            return
          }
          ownerGUID = lobbyIDForUserRows[0].guid
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

              console.log(`${logTimestamp} Creating Server on Port ${createdServerPort} with ID ${lobbyID} with ${req.body.maxPlayers} Max Players`)
              shell.exec(
                `/home/phro/Server/LinuxArm64Server/CorruptedMemoryServer-Arm64.sh -log -port=${createdServerPort} -lobbyID=${lobbyID} -CMServerSecret=${process.env.CM_SECRET} -maxPlayers=${req.body.maxPlayers}`,
                {
                  async: true
                }
              )
              io.to('client').emit('create', { lobbyID: lobbyID, port: createdServerPort })
            })
            .then(() => {
              return conn.query('INSERT INTO lobbies value (?, ?, ?, ?, ?, NOW())', [lobbyID, createdServerPort, 'lobby', ownerGUID, req.body.maxPlayers])
            })
            .then((response) => {
              console.log(`${logTimestamp} Database Entry Created for ${lobbyID}`)
              res.send({ lobbyID: lobbyID, port: createdServerPort })
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

router.post('/join', authenticateJWT, express.json(), async (req, res) => {
  if (!(await hasPerms(['JOIN_LOBBY'], req.user))) {
    res.sendStatus(403)
    return
  }
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT id FROM lobbies WHERE id = ?', [req.body.lobbyID])
        .then((rows) => {
          if (rows.length === 0) {
            console.log(`${logTimestamp} ${clc.bold(req.user.username)} ${clc.red('Invalid Lobby ID')}`)
            res.sendStatus(404)
            conn.end()
            return
          }
          conn
            .query('SELECT 1 FROM players WHERE lobbyid IS NOT NULL AND username = ?', [req.user.username])
            .then((lobbyIDForUserRows) => {
              if (lobbyIDForUserRows.length > 0) {
                console.log(`${logTimestamp} ${clc.bold(req.user.username)} ${clc.red('Already in a Lobby')}`)
                res.sendStatus(409)
                conn.end()
                return
              }
              conn
                .query('UPDATE players SET lobbyid = ?, joinedLobbyAt = NOW() WHERE username = ?', [req.body.lobbyID, req.user.username])
                .then((response) => {
                  console.log(`${logTimestamp} ${clc.bold(req.user.username)} Joined ${clc.bold(req.body.lobbyID)}`)
                  io.emit('join', { username: req.user.username, lobbyID: req.body.lobbyID })
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
              //handle error
              console.log(err)
              res.sendStatus(500)
              conn.end()
            })
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

router.post('/leave', authenticateJWT, express.json(), async (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT 1 FROM players WHERE lobbyid IS NULL AND username = ?', [req.user.username])
        .then((lobbyIDForUserRows) => {
          if (lobbyIDForUserRows.length > 0) {
            console.log(`${logTimestamp} ${clc.bold(req.user.username)} ${clc.red('Not in a Lobby')}`)
            res.sendStatus(409)
            conn.end()
            return
          }
          conn
            .query('UPDATE players SET lobbyid = NULL, joinedLobbyAt = NULL WHERE username = ?', [req.user.username])
            .then((response) => {
              console.log(`${logTimestamp} ${clc.bold(req.user.username)} Left Lobby`)
              io.emit('leave', { username: req.user.username, lobbyID: req.body.lobbyID })
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
        .query('SELECT *, (SELECT COUNT(*) FROM players, lobbies WHERE players.lobbyid = lobbies.id) AS "online" FROM lobbies')
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
        .query('SELECT * FROM lobbies WHERE id = ?', [req.params.id])
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

router.get('/lobby/players/:id', authenticateJWT, (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query(
          'SELECT username user, (SELECT CASE WHEN EXISTS (SELECT 1 FROM players, lobbies WHERE players.guid = lobbies.owner AND username = user) THEN TRUE ELSE FALSE END) AS "isOwner" FROM players WHERE lobbyid = ? ORDER BY joinedLobbyAt DESC',
          [req.params.id]
        )
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

router.delete('/lobbies/:lobbyid', (req, res) => {
  io.to(req.params.lobbyid + '/A').emit('command', 'stop')
  console.log(`${logTimestamp} Stopping Server ${req.params.lobbyid}`)
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('DELETE FROM lobbies WHERE id = ?', [req.params.lobbyid])
        .then((rows) => {
          console.log(`${logTimestamp} Lobby ${req.params.lobbyid} Deleted`)
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

router.post('/login', express.json(), (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT username, password FROM players WHERE username = ?', [req.body.username])
        .then((rows) => {
          if (rows.length === 0) {
            console.log(`${logTimestamp} ${clc.red(`Invalid Username ${req.body.username}`)}`)
            res.sendStatus(404)
            conn.end()
          } else {
            if (!(req.body.username == rows[0].username)) {
              console.log(`${logTimestamp} ${clc.red(`Invalid Username ${req.body.username}`)}`)
              res.sendStatus(404)
              conn.end()
              return
            }
            bcrypt
              .compare(req.body.password, rows[0].password)
              .then((passwordCompareResult) => {
                if (passwordCompareResult) {
                  console.log(`${logTimestamp} ${clc.green('Login')} ${clc.bold(req.body.username)}`)
                  conn.query('UPDATE players SET lastLogin = NOW() WHERE username = ?', [req.body.username]).catch((err) => {
                    console.error(err.message)
                  })
                  conn
                    .query('SELECT guid FROM sessions, players WHERE sessions.playerGUID = players.guid AND username = ?', [req.body.username])
                    .then((response) => {
                      if (response.length > 0) {
                        conn.query('UPDATE sessions, players SET sessions.ip = ? WHERE sessions.playerGUID = players.guid AND username = ?', [getIP(req), req.body.username]).catch((err) => {
                          console.error(err.message)
                        })
                      } else {
                        conn
                          .query('SELECT guid FROM players WHERE username = ?', [req.body.username])
                          .then((guid) => {
                            conn.query('INSERT INTO sessions VALUES (?, ?, ?)', [crypto.randomUUID(), guid[0].guid, getIP(req)]).catch((err) => {
                              console.error(err.message)
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
                      console.error(err.message)
                    })
                  const token = jwt.sign({ username: req.body.username }, process.env.JWT_SECRET, { expiresIn: '1d' })
                  res.send({ user: req.body.username, token: token })
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
        .query('DELETE sessions FROM sessions INNER JOIN players WHERE sessions.playerGUID = players.guid AND username = ?', [req.user.username])
        .then((rows) => {
          console.log(`${logTimestamp} ${clc.red('Logout')} ${clc.bold(req.user.username)}`)
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
  req.body.username = req.body.username.trim()
  if (req.body.username.includes(' ') || req.body.username === '') {
    console.log(`${clc.red(`${logTimestamp} Username Cannot Contain Spaces`)}`)
    res.sendStatus(400)
    return
  }
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT 1 FROM sessions, players WHERE sessions.playerGUID = players.guid AND username = ?', [req.body.username])
        .then((rows) => {
          if (rows.length > 0) {
            console.log(`${clc.red(`${logTimestamp} Username ${clc.bold(req.body.username)} Already Exists`)}`)
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
                  .query('INSERT INTO players VALUES (?, ?, ?, ?, NULL, NOW(), NOW(), NULL)', [crypto.randomUUID(), req.body.username, hash, defaultPerms])
                  .then((response) => {
                    console.log(`${logTimestamp} Registration ${clc.bold(req.body.username)}`)
                    res.sendStatus(201)
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

router.delete('/delete', authenticateJWT, async (req, res) => {
  if (!(await hasPerms(['DELETE_ACCOUNT'], req.user))) {
    res.sendStatus(403)
    return
  }
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('DELETE FROM players WHERE username = ?', [req.user.username])
        .then((rows) => {
          console.log(`${logTimestamp} ${clc.bold(req.user.username)} Deleted`)
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

const clamp = (num, min, max) => Math.min(Math.max(num, min), max)

module.exports = router
