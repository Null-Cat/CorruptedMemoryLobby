require('dotenv').config()
const express = require('express')
const app = express()
const server = require('http').createServer(app)
const io = require('socket.io')(server, { cors: { origin: '*' } })
const clc = require('cli-color')
const jwt = require('jsonwebtoken')
const mariadbPool = require('./utilities/mariadbPool')
const { logTimestamp, authenticateJWT } = require('./utilities/utilities')

const port = process.env.PORT || 4000

app.set('view engine', 'ejs')
app.set('views', './views')
app.enable('trust proxy')
app.use(express.urlencoded({ extended: true }))

app.use(LogConnections)

app.use(express.static('public'))
app.use('/api', require('./routes/api'))

app.get('/', (req, res) => {})

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
          console.log(res)
          console.log(`${logTimestamp} Database Cleared`)
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

io.on('connection', (socket) => {
  console.log(`${logTimestamp} New Socket Connection ${clc.magenta(`${socket.id}`)}`)
  //const referer = new URL(socket.request.headers.referer)

  socket.on('authority', (authorityData) => {
    socket.join(authorityData.lobbyID)
    console.log(`${logTimestamp} ${clc.magenta(`${socket.id}`)} Joined ${clc.magenta(`${authorityData.lobbyID}`)}`)
    socket.to(authorityData.lobbyID).emit('authority', authorityData)
    console.log(`${logTimestamp} ${clc.yellow(`${authorityData.secret}`)} Authority ${clc.green('Confirmed')}`)
  })

  socket.on('disconnect', () => {
    console.log(`${logTimestamp} Socket ${clc.red(`Disconnected`)} ${clc.magenta(socket.id)}`)
  })
})
