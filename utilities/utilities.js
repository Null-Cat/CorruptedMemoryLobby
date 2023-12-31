const jwt = require('jsonwebtoken')
const jwtSecret = process.env.JWT_SECRET
const clc = require('cli-color')
const mariadbPool = require('./mariadbPool')
const express = require('express')
const app = express()
const server = require('http').createServer(app)
const io = require('socket.io')(server, { cors: { origin: '*' } })

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

function getIP(req) {
  return req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress
}

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization

  if (authHeader) {
    const token = authHeader.split(' ')[1]

    jwt.verify(token, jwtSecret, async (err, user) => {
      if (err) {
        console.log(`${logTimestamp} ${clc.bold(user.username)} ${clc.red('Invalid/Unauthorized Token')}`)
        return res.sendStatus(403)
      }
      await mariadbPool.pool
        .getConnection()
        .then((conn) => {
          conn
            .query('SELECT 1 FROM sessions, players WHERE sessions.playerGUID = players.guid AND username = ?', [user.username])
            .then((rows) => {
              if (rows.length == 0) {
                console.log(`${logTimestamp} ${clc.bold(user.username)} Session ${clc.red('Expired')}`)
                return res.sendStatus(401)
              } else {
                console.log(`${logTimestamp} ${clc.bold(user.username)} ${clc.green('Authenticated')}`)
                req.user = user
                next()
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
  } else {
    console.log(`${logTimestamp} ${clc.red('Not Authenticated')}`)
    res.sendStatus(401)
    return
  }
}

async function hasPerms(requiredPerms, user) {
  return (pr = new Promise(function (resolve, reject) {
    mariadbPool.pool
      .getConnection()
      .then((conn) => {
        conn
          .query('SELECT perms FROM players WHERE username = ?', [user.username])
          .then((rows) => {
            if (rows.length == 0) {
              console.log(`${logTimestamp} ${clc.red('Invalid')} Username`)
              resolve(false)
              conn.end()
              return
            } else {
              var perms = rows[0].perms
              for (var i = 0; i < requiredPerms.length; i++) {
                if (!perms.includes(requiredPerms[i])) {
                  console.log(`${logTimestamp} User ${clc.bold(user.username)} has ${clc.red('Invalid')} ${requiredPerms.join(', ')} Permissions`)
                  resolve(false)
                  conn.end()
                  return
                }
              }
              console.log(`${logTimestamp} User ${user.username} has ${clc.green('Valid')} ${requiredPerms.join(', ')} Permissions`)
              resolve(true)
              conn.end()
              return
            }
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
  }))
}

module.exports = { logTimestamp, getIP, authenticateJWT, hasPerms, app, server, io }
