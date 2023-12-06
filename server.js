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
        .query('DELETE FROM lobbies')
        .then((res) => {
          conn
            .query('UPDATE players SET lobbyID = NULL, joinedLobbyAt = NULL WHERE lobbyID IS NOT NULL')
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
  //const referer = new URL(socket.request.headers.referer)

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
    // if (commandData.lobbyID !== socket.data.lobbyID) {
    //   console.log(`${logTimestamp} Command ${clc.red('Denied')} ${clc.magenta(`${socket.id}`)} No Authority in ${clc.magenta(`${commandData.lobbyID}`)}`)
    //   return
    // }
    // console.log(`${logTimestamp} Authority ${clc.green('Confirmed')} ${clc.magenta(`${socket.id}`)} ${clc.magenta(`${commandData.lobbyID}`)}`)
    if (commandData.command === 'stop') {
      socket.to(commandData.lobbyID + '/A').emit('command', 'stop')
      console.log(`${logTimestamp} Command ${clc.yellow('Stop')} ${clc.green('Sent')} to Server ${clc.magenta(`${commandData.lobbyID}`)}`)
    }
  })

  socket.on('join', (joinData) => {
    socket.to(joinData.lobbyID).emit('join', joinData)
    console.log(`${logTimestamp} Player ${clc.magenta(`${joinData.username}`)} Joined Lobby ${clc.magenta(`${joinData.lobbyID}`)}`)
    socket.join(joinData.lobbyID)
  })

  socket.on('leave', (leaveData) => {
    socket.leave(leaveData.lobbyID)
    console.log(`${logTimestamp} Player ${clc.magenta(`${leaveData.username}`)} Left Lobby ${clc.magenta(`${leaveData.lobbyID}`)}`)
    socket.to(leaveData.lobbyID).emit('leave', leaveData)
  })

  socket.on('disconnect', () => {
    console.log(`${logTimestamp} Client Socket ${clc.red(`Disconnected`)} ${clc.magenta(socket.id)}`)
  })
})
