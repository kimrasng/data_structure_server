const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')
const crypto = require('crypto')

router.get('/', asyncHandler(async (req, res) => {
    const [devices] = await pool.query('SELECT * FROM devices')
    res.json(devices)
}))

router.post('/', asyncHandler(async (req, res) => {
    const { device_name, location, threshold } = req.body

    if (!device_name || !location) {
      return res
        .status(400)
        .json({ error: 'device_name과 location은 필수입니다.' })
    }

    const url =
      'http://example.com/crowd_data/' +
      device_name +
      '_' +
      crypto.randomBytes(8).toString('hex')

    const [result] = await pool.query(
      'INSERT INTO devices (device_name, location, url) VALUES (?, ?, ?)',
      [device_name, location, url]
    )
    const deviceId = result.insertId

    const t = threshold || {}
    await pool.query(
      'INSERT INTO threshold (id, safe, normal, warning, danger) VALUES (?, ?, ?, ?, ?)',
      [deviceId, t.safe || 30, t.normal || 50, t.warning || 80, t.danger || 120]
    )

    res.status(201).json({ id: deviceId, device_name, location, url })
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
    const deviceId = req.params.id
    const [devices] = await pool.query('SELECT * FROM devices WHERE id = ?', [deviceId])

    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }

    const device = devices[0]

    const [thresholds] = await pool.query('SELECT * FROM threshold WHERE id = ?', [deviceId])

    const threshold = thresholds[0] || {}

    res.json({ ...device, threshold })

}))


router.put('/:id', asyncHandler(async (req, res) => {
    const deviceId = req.params.id
    const { device_name, location, threshold } = req.body

    const [devices] = await pool.query(
        'SELECT * FROM devices WHERE id = ?',
        [deviceId]
    )
    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }

    if (device_name || location) {
        const newName = device_name || devices[0].device_name
        const newLocation = location || devices[0].location
        await pool.query(
            'UPDATE devices SET device_name = ?, location = ? WHERE id = ?',
            [newName, newLocation, deviceId]
        )
    }

    const hasThresholdFields =
        threshold &&
        ['safe', 'normal', 'warning', 'danger'].some(
            (k) => Object.prototype.hasOwnProperty.call(threshold, k) && threshold[k] !== undefined
        )

    if (hasThresholdFields) {
        const [thRows] = await pool.query(
            'SELECT * FROM threshold WHERE id = ?',
            [deviceId]
        )
        const existing = thRows[0] || {}

        const safe = threshold.safe ?? existing.safe ?? 30
        const normal = threshold.normal ?? existing.normal ?? 50
        const warning = threshold.warning ?? existing.warning ?? 80
        const danger = threshold.danger ?? existing.danger ?? 120

        if (thRows.length === 0) {
            await pool.query(
                'INSERT INTO threshold (id, safe, normal, warning, danger) VALUES (?, ?, ?, ?, ?)',
                [deviceId, safe, normal, warning, danger]
            )
        } else {
            await pool.query(
                'UPDATE threshold SET safe = ?, normal = ?, warning = ?, danger = ? WHERE id = ?',
                [safe, normal, warning, danger, deviceId]
            )
        }
    }

    const [updated] = await pool.query(
        'SELECT * FROM devices WHERE id = ?',
        [deviceId]
    )
    const [updatedThreshold] = await pool.query(
        'SELECT safe, normal, warning, danger FROM threshold WHERE id = ?',
        [deviceId]
    )

    res.json({
        ...updated[0],
        threshold: updatedThreshold[0] || {},
    })
}))

module.exports = router