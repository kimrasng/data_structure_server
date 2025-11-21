const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')
const crypto = require('crypto')

/**
 * @swagger
 * components:
 *   schemas:
 *     Threshold:
 *       type: object
 *       properties:
 *         safe:
 *           type: integer
 *           description: The headcount threshold considered 'safe'.
 *           example: 30
 *         normal:
 *           type: integer
 *           description: The headcount threshold considered 'normal'.
 *           example: 50
 *         warning:
 *           type: integer
 *           description: The headcount threshold considered 'warning'.
 *           example: 80
 *         danger:
 *           type: integer
 *           description: The headcount threshold considered 'danger'.
 *           example: 120
 *     Device:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: The unique identifier for the device.
 *         device_name:
 *           type: string
 *           description: The name of the device.
 *         location:
 *           type: string
 *           description: The physical location of the device.
 *         url:
 *           type: string
 *           description: The unique URL for the device to post data to.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: The timestamp when the device was registered.
 *     DeviceWithThreshold:
 *       allOf:
 *         - $ref: '#/components/schemas/Device'
 *         - type: object
 *           properties:
 *             threshold:
 *               $ref: '#/components/schemas/Threshold'
 */

/**
 * @swagger
 * tags:
 *   name: Devices
 *   description: API for managing monitoring devices.
 */

/**
 * @swagger
 * /devices:
 *   get:
 *     summary: Retrieve a list of all devices
 *     tags: [Devices]
 *     responses:
 *       200:
 *         description: A list of devices.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Device'
 */
router.get('/', asyncHandler(async (req, res) => {
    const [devices] = await pool.query('SELECT * FROM devices')
    res.json(devices)
}))

/**
 * @swagger
 * /devices:
 *   post:
 *     summary: Register a new device
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_name
 *               - location
 *             properties:
 *               device_name:
 *                 type: string
 *                 example: "Main Entrance Camera"
 *               location:
 *                 type: string
 *                 example: "1st Floor, West Wing"
 *               threshold:
 *                 $ref: '#/components/schemas/Threshold'
 *     responses:
 *       201:
 *         description: The newly created device.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Device'
 *       400:
 *         description: Missing required fields.
 */
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
      'INSERT INTO threshold (device_id, safe, normal, warning, danger) VALUES (?, ?, ?, ?, ?)',
      [deviceId, t.safe || 30, t.normal || 50, t.warning || 80, t.danger || 120]
    )

    res.status(201).json({ id: deviceId, device_name, location, url })
  })
)

/**
 * @swagger
 * /devices/{id}:
 *   get:
 *     summary: Get a specific device by ID
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The device ID.
 *     responses:
 *       200:
 *         description: The device data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceWithThreshold'
 *       404:
 *         description: Device not found.
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const deviceId = req.params.id
    const [devices] = await pool.query('SELECT * FROM devices WHERE id = ?', [deviceId])

    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }

    const device = devices[0]

    const [thresholds] = await pool.query('SELECT * FROM threshold WHERE device_id = ?', [deviceId])

    const threshold = thresholds[0] || {}

    res.json({ ...device, threshold })

}))

/**
 * @swagger
 * /devices/{id}:
 *   put:
 *     summary: Update a device's information and/or thresholds
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The device ID.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_name:
 *                 type: string
 *                 example: "Main Entrance Camera (Updated)"
 *               location:
 *                 type: string
 *                 example: "1st Floor, Main Lobby"
 *               threshold:
 *                 $ref: '#/components/schemas/Threshold'
 *     responses:
 *       200:
 *         description: The updated device data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceWithThreshold'
 *       404:
 *         description: Device not found.
 */
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
            'SELECT * FROM threshold WHERE device_id = ?',
            [deviceId]
        )
        const existing = thRows[0] || {}

        const safe = threshold.safe ?? existing.safe ?? 30
        const normal = threshold.normal ?? existing.normal ?? 50
        const warning = threshold.warning ?? existing.warning ?? 80
        const danger = threshold.danger ?? existing.danger ?? 120

        if (thRows.length === 0) {
            await pool.query(
                'INSERT INTO threshold (device_id, safe, normal, warning, danger) VALUES (?, ?, ?, ?, ?)',
                [deviceId, safe, normal, warning, danger]
            )
        } else {
            await pool.query(
                'UPDATE threshold SET safe = ?, normal = ?, warning = ?, danger = ? WHERE device_id = ?',
                [safe, normal, warning, danger, deviceId]
            )
        }
    }

    const [updated] = await pool.query(
        'SELECT * FROM devices WHERE id = ?',
        [deviceId]
    )
    const [updatedThreshold] = await pool.query(
        'SELECT safe, normal, warning, danger FROM threshold WHERE device_id = ?',
        [deviceId]
    )

    res.json({
        ...updated[0],
        threshold: updatedThreshold[0] || {},
    })
}))

module.exports = router