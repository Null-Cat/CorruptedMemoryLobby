require('dotenv').config()
const express = require('express')
const fs = require('fs')
const clc = require('cli-color')
const shell = require('shelljs')
const mariadb = require('mariadb')
const pool = mariadb.createPool({
  host: '192.168.0.79',
  user: 'cm-client',
  password: process.env.DB_PASSWORD,
  connectionLimit: 5
})

const app = express()
const port = process.env.PORT || 4000

// app.set('view engine', 'ejs')
// app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendStatus(200)
})

app.get('/api/create', (req, res) => {
  let lobbyID = makeID(5)
  let createdServerPort
  pool
    .getConnection()
    .then((conn) => {
      conn
        .query('USE corruptedmemory')
        .then(() => {
          conn
            .query('SELECT Port FROM Lobbies ORDER BY Port DESC')
            .then((rows) => {
              if (rows.length === 0) {
                createdServerPort = 7777
              } else {
                createdServerPort = rows[0].Port + 1
              }
              console.log(`${logTimestamp} Creating Server on Port ${createdServerPort} with ID ${lobbyID}`)
            })
            .then(() => {
              return conn.query('INSERT INTO Lobbies value (?, ?)', [lobbyID, createdServerPort])
            })
            .then((response) => {
              console.log(response)
              console.log(`${logTimestamp} Database Entry Created for ${lobbyID}`)
              shell.exec(`/home/phro/Server/LinuxArm64Server/CorruptedMemoryServer-Arm64.sh -log -port=${createdServerPort}`, { async: true })
              console.log(`${logTimestamp} Server Created`)
              res.send({ lobbyID: lobbyID, port: createdServerPort })
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
})

app.get('/api/lobbies', (req, res) => {
  pool
    .getConnection()
    .then((conn) => {
      conn
        .query('USE corruptedmemory')
        .then(() => {
          return conn.query('SELECT * FROM Lobbies')
        })
        .then((rows) => {
          res.send(rows)
          conn.end()
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
})

app.get('/api/lobbies/:id', (req, res) => {
  pool
    .getConnection()
    .then((conn) => {
      conn
        .query('USE corruptedmemory')
        .then(() => {
          return conn.query('SELECT port FROM Lobbies WHERE LobbyID = ?', [req.params.id])
        })
        .then((rows) => {
          res.send(rows)
          conn.end()
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

app.listen(port, () => {
  console.log(`${clc.green(`${logTimestamp} Listening on port ${port}`)}`)
  pool
    .getConnection()
    .then((conn) => {
      conn
        .query('USE corruptedmemory')
        .then(() => {
          return conn.query('DELETE FROM Lobbies')
        })
        .then((res) => {
          console.log(res)
          console.log(`${logTimestamp} Database Cleared`)
          conn.end()
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
})

var date = new Date(),
  logTimestamp =
    ('00' + (date.getMonth() + 1)).slice(-2) +
    '/' +
    ('00' + date.getDate()).slice(-2) +
    '/' +
    date.getFullYear() +
    ':' +
    ('00' + date.getHours()).slice(-2) +
    ':' +
    ('00' + date.getMinutes()).slice(-2) +
    ':' +
    ('00' + date.getSeconds()).slice(-2)

function makeID(length) {
  let result = ''
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const charactersLength = characters.length
  let counter = 0
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}
