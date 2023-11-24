require('dotenv').config()
const express = require('express')
const fs = require('fs')
const clc = require('cli-color')
const shell = require('shelljs')
const mariadb = require('mariadb')
const pool = mariadb.createPool({
  host: '192.168.0.79',
  user: 'em-client',
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
  console.log(`${logTimestamp} Creating Server on Port 7777`)
  shell.exec('/home/phro/Server/LinuxArm64Server/CorruptedMemoryServer-Arm64.sh -log', {async:true})
  console.log(`${logTimestamp} Server Created`)
  res.sendStatus(200)
})

app.get('/api/lobbies', (req, res) => {})

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
  console.log(`${clc.green(`Listening on port ${port}`)}`)
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
