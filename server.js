require('dotenv').config()
const express = require('express')
const clc = require('cli-color')
const jwt = require('jsonwebtoken')
const mariadbPool = require('./utilities/mariadbPool')
const { logTimestamp, authenticateJWT, app, server, io } = require('./utilities/utilities')

const port = process.env.PORT || 4000

app.set('view engine', 'ejs')
app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

app.use(express.static('public'))
app.use('/api', require('./routes/api'))

app.get('/', (req, res) => {
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('SELECT * FROM lobbies')
        .then((rows) => {
          res.render('index.ejs', { lobbies: rows })
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

app.all('*', (req, res) => {
  res.sendStatus(404)
})

function LogConnections(req, res, next) {
  console.log(
    `${logTimestamp} ${clc.inverse(req.method)} request for ${clc.underline(req.url)} from ${clc.cyan(
      req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress
    )}`
  )
  next()
}

server.listen(port, () => {
  console.log(`${clc.green(`${logTimestamp} Listening on port ${port}`)}`)
  mariadbPool.pool
    .getConnection()
    .then((conn) => {
      conn
        .query('UPDATE players SET isReady = FALSE, lobbyID = NULL, joinedLobbyAt = NULL WHERE lobbyID IS NOT NULL OR isReady = TRUE')
        .then((res) => {
          conn
            .query('DELETE FROM lobbies')
            .then((res) => {
              console.log(`${logTimestamp} Lobbies Table Cleared`)
              conn.end()
            })
            .catch((err) => {
              console.log(err)
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

io.on('connection', (socket) => {
  console.log(`${logTimestamp} New Socket Connection ${clc.magenta(`${socket.id}`)}`)

  socket.on('authority', (authorityData) => {
    if (authorityData.authority === 'client') {
      console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Client Joined Room ${clc.magenta('client')}`)
      socket.join('client')
      return
    }
    if (authorityData.secret !== process.env.CM_SECRET) {
      console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Authority ${clc.red('Denied')} for ${clc.magenta(`${authorityData.lobbyID}`)} Invalid Secret`)
      socket.disconnect()
      return
    }
    console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Authority ${clc.green('Confirmed')} for ${clc.magenta(`${authorityData.lobbyID}`)}`)
    socket.join('server')
    console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Server Joined Room ${clc.magenta('server')}`)
    socket.join(authorityData.lobbyID + '/A')
    console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Server Joined Room ${clc.magenta(`${authorityData.lobbyID + '/A'}`)}`)
  })

  socket.on('command', (commandData) => {
    if (commandData.command === 'stop') {
      socket.to(commandData.lobbyID + '/A').emit('command', 'stop')
      console.log(`${logTimestamp} Command ${clc.yellow('Stop')} ${clc.green('Sent')} to Server ${clc.magenta(`${commandData.lobbyID}`)}`)
    }
  })

  socket.on('join', (joinData) => {
    socket.to(joinData.lobbyID).emit('join', joinData)
    socket.data.lobbyID = joinData.lobbyID
    console.log(`${logTimestamp} Player ${clc.magenta(`${joinData.username}`)} Joined Lobby ${clc.magenta(`${joinData.lobbyID}`)}`)
    socket.join(joinData.lobbyID)
  })

  socket.on('leave', (leaveData) => {
    socket.leave(leaveData.lobbyID)
    socket.data.lobbyID = null
    console.log(`${logTimestamp} Player ${clc.magenta(`${leaveData.username}`)} Left Lobby ${clc.magenta(`${leaveData.lobbyID}`)}`)
    socket.to(leaveData.lobbyID).emit('leave', leaveData)
  })

  socket.on('login', (loginData) => {
    socket.data.username = loginData
    console.log(`${logTimestamp} Player ${clc.magenta(`${loginData}`)} Logged In Socket ${clc.magenta(`${socket.id}`)}`)
  })

  socket.on('ready', (readyData) => {
    mariadbPool.pool.getConnection().then((conn) => {
      conn
        .query('SELECT 1 FROM players WHERE username = ?', [readyData.username])
        .then((rows) => {
          if (rows.length == 0) {
            console.log(`${logTimestamp} ${clc.red('Invalid')} Username ${clc.magenta(`${readyData.username}`)}`)
            conn.end()
            return
          }
          conn
            .query('SELECT 1 FROM players WHERE lobbyid = ? AND username = ?', [readyData.lobbyID, readyData.username])
            .then((rows) => {
              if (rows.length == 0) {
                console.log(`${logTimestamp} ${clc.red('Invalid')} Lobby ${clc.magenta(`${readyData.lobbyID}`)} for ${clc.magenta(`${readyData.username}`)}`)
                conn.end()
                return
              }
              conn
                .query('UPDATE players SET isReady = TRUE WHERE lobbyid = ? AND username = ?', [readyData.lobbyID, readyData.username])
                .then((rows) => {
                  console.log(`${logTimestamp} Player ${clc.magenta(`${readyData.username}`)} Ready in Lobby ${clc.magenta(`${readyData.lobbyID}`)}`)
                  socket.to(readyData.lobbyID).emit('ready', readyData)
                  console.log(`${logTimestamp} Player ${clc.magenta(`${readyData.username}`)} Ready in Lobby ${clc.magenta(`${readyData.lobbyID}`)}`)
                  conn.end()
                })
                .catch((err) => {
                  //handle error
                  console.log(err)
                  conn.end()
                })
            })
            .catch((err) => {
              //handle error
              console.log(err)
              conn.end()
            })
        })
        .catch((err) => {
          //handle error
          console.log(err)
          conn.end()
        })
    })
  })

  socket.on('unready', (unreadyData) => {
    mariadbPool.pool.getConnection().then((conn) => {
      conn
        .query('SELECT 1 FROM players WHERE username = ?', [unreadyData.username])
        .then((rows) => {
          if (rows.length == 0) {
            console.log(`${logTimestamp} ${clc.red('Invalid')} Username ${clc.magenta(`${unreadyData.username}`)}`)
            conn.end()
            return
          }
          conn
            .query('SELECT 1 FROM players WHERE lobbyid = ? AND username = ?', [unreadyData.lobbyID, unreadyData.username])
            .then((rows) => {
              if (rows.length == 0) {
                console.log(`${logTimestamp} ${clc.red('Invalid')} Lobby ${clc.magenta(`${unreadyData.lobbyID}`)} for ${clc.magenta(`${unreadyData.username}`)}`)
                conn.end()
                return
              }
              conn
                .query('UPDATE players SET isReady = FALSE WHERE lobbyid = ? AND username = ?', [unreadyData.lobbyID, unreadyData.username])
                .then((rows) => {
                  socket.to(unreadyData.lobbyID).emit('unready', unreadyData)
                  console.log(`${logTimestamp} Player ${clc.magenta(`${unreadyData.username}`)} Not Ready in Lobby ${clc.magenta(`${unreadyData.lobbyID}`)}`)
                  conn.end()
                })
                .catch((err) => {
                  //handle error
                  console.log(err)
                  conn.end()
                })
            })
            .catch((err) => {
              //handle error
              console.log(err)
              conn.end()
            })
        })
        .catch((err) => {
          //handle error
          console.log(err)
          conn.end()
        })
    })
  })

  socket.on('start', (startData) => {
    mariadbPool.pool.getConnection().then((conn) => {
      conn
        .query('SELECT 1 FROM lobbies WHERE id = ?', [startData])
        .then((rows) => {
          if (rows.length === 0) {
            console.log(`${logTimestamp} ${clc.red('Invalid')} Lobby ${clc.magenta(`${startData}`)}`)
            conn.end()
            return
          }
          conn
            .query('UPDATE lobbies SET status = "In Game" WHERE id = ?', [startData])
            .then((rows) => {
              console.log(`${logTimestamp} Lobby ${clc.magenta(`${startData}`)} Game Started`)
              socket.to(startData).emit('start', startData)
              conn.end()
            })
            .catch((err) => {
              //handle error
              console.log(err)
              conn.end()
            })
        })
        .catch((err) => {
          //handle error
          console.log(err)
          conn.end()
        })
    })
  })

  socket.on('disconnect', () => {
    console.log(`${logTimestamp} Client Socket ${clc.red(`Disconnected`)} ${clc.magenta(socket.id)}`)
    if (socket.data.lobbyID) {
      mariadbPool.pool
        .getConnection()
        .then((conn) => {
          conn
            .query('SELECT 1 FROM players WHERE lobbyid IS NULL AND username = ?', [socket.data.username])
            .then((lobbyIDForUserRows) => {
              if (lobbyIDForUserRows.length > 0) {
                console.log(`${logTimestamp} ${clc.bold(socket.data.username)} ${clc.red('Not in a Lobby')}`)
                conn.end()
                return
              }
              conn
                .query('SELECT 1 FROM players, lobbies WHERE players.guid = lobbies.owner AND lobbyid = ? AND username = ?', [socket.data.lobbyID, socket.data.username])
                .then((isOwner) => {
                  if (isOwner.length > 0) {
                    io.to(socket.data.lobbyID + '/A').emit('command', 'stop')
                    console.log(`${logTimestamp} Stopping Server ${clc.magenta(socket.data.lobbyID)} As Owner Left`)
                    conn
                      .query('UPDATE players SET isReady = FALSE, lobbyID = NULL, joinedLobbyAt = NULL WHERE lobbyID = ?', [socket.data.lobbyID])
                      .then((rows) => {
                        conn
                          .query('DELETE FROM lobbies WHERE id = ?', [socket.data.lobbyID])
                          .then((rows) => {
                            console.log(`${logTimestamp} Lobby ${clc.magenta(socket.data.lobbyID)} Deleted`)
                            io.to(socket.data.lobbyID).emit('close', { message: 'Server Closed' })
                            io.socketsLeave(socket.data.lobbyID)
                            console.log(`${logTimestamp} Lobby ${clc.magenta(socket.data.lobbyID)} Socket Room Closed`)
                          })
                          .catch((err) => {
                            console.log(err)
                            conn.end()
                          })
                      })
                      .catch((err) => {
                        //handle error
                        console.log(err)
                        conn.end()
                      })
                  } else {
                    conn
                      .query('UPDATE players SET isReady = FALSE, lobbyid = NULL, joinedLobbyAt = NULL WHERE username = ?', [socket.data.username])
                      .then((response) => {
                        console.log(`${logTimestamp} ${clc.bold(socket.data.username)} Left Lobby ${clc.magenta(socket.data.lobbyID)}`)
                        io.emit('leave', { username: socket.data.username, lobbyID: socket.data.lobbyID })
                        conn.end()
                      })
                      .catch((err) => {
                        //handle error
                        console.log(err)
                        conn.end()
                      })
                  }
                })
                .catch((err) => {
                  //handle error
                  console.log(err)
                  conn.end()
                })
            })
            .catch((err) => {
              //handle error
              console.log(err)
              conn.end()
            })
        })
        .catch((err) => {
          console.log(err)
        })
    }
  })
})
