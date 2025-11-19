const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')

router.post('/:uniq_url', asyncHandler(async (req, res) => {
    const uniqUrl = req.params.uniq_url
    let macs = req.body

    if (typeof macs === 'string') {
        macs = [macs]
    }

    if (!Array.isArray(macs) || macs.length === 0) {
        return res.status(400).json({ error: 'MAC 주소가 필요합니다.' })
    }

    const [devices] = await pool.query('SELECT * FROM devices WHERE url LIKE ?', ['%' + uniqUrl])

    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }

    const thisDevice = devices[0]

    const [thresholds] = await pool.query('SELECT * FROM threshold WHERE id = ?', [thisDevice.id])

    if (thresholds.length === 0) {
        return res.status(500).json({ error: 'Threshold not set for this device' })
    }

}))

module.exports = router