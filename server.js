const express = require('express')
const app = express()
const port = 3000

const DeviceRouter = require('./src/router/devices')

module.exports = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}

app.use(express.json())

app.use('/devices', DeviceRouter)

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})

app.use((err, req, res, next) => {
    console.error('ERROR:', err)
    res.status(500).json({ error: 'Internal Server Error' })
})
