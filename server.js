const express = require('express')
const app = express()
const port = 3000

module.exports = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}

app.use(express.json())

app.use('/devices', require('./src/router/devices'))
app.use('/crowd_data', require('./src/router/crowd_data'))

app.use((err, req, res, next) => {
    console.error('ERROR:', err)
    res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})