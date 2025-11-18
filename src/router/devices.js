const express = require('express')
const router = express.Router()
const asyncHandler = require('./utils/asyncHandler')
const query = require('./utils/db')

router.get('/', async (req, res) => {
    res.send('Devices')
})

module.exports = router