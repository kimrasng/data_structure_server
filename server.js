const express = require('express')
const app = express()
const port = 3000
const swaggerUi = require('swagger-ui-express')
const swaggerJsdoc = require('swagger-jsdoc')

module.exports = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}

app.use(express.json())

// Swagger setup
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'Crowd Monitoring API',
            version: '1.0.0',
            description: 'API for monitoring crowd density and mobility to prevent accidents.',
        },
        servers: [
            {
                url: `http://localhost:${port}`,
            },
        ],
    },
    apis: ['./src/router/*.js'],
}

const swaggerDocs = swaggerJsdoc(swaggerOptions)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs))

app.use('/devices', require('./src/router/devices'))
app.use('/crowd_data', require('./src/router/crowd_data'))
app.use('/webhooks', require('./src/router/webhooks'))

app.use((err, req, res, next) => {
    console.error('ERROR:', err)
    res.status(500).json({ error: 'Internal Server Error' })
})

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})