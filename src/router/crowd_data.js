const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')
const { hashMac, getStatus, clampPrediction, analyzeMobility } = require('../utils/crowdHelper')
const axios = require('axios')

/**
 * @swagger
 * components:
 *   schemas:
 *     CrowdData:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: The unique ID of the crowd data record.
 *         device_id:
 *           type: integer
 *           description: The ID of the device that collected the data.
 *         headcount:
 *           type: integer
 *           description: The estimated number of people.
 *         status:
 *           type: string
 *           enum: [safe, normal, warning, danger]
 *           description: The crowd status based on the headcount.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: The timestamp of the data collection.
 *     NeighborPrediction:
 *        type: object
 *        properties:
 *          device_id:
 *            type: integer
 *          device_name:
 *            type: string
 *          location:
 *            type: string
 *          current:
 *            type: integer
 *            description: The current headcount for this device.
 *          previous:
 *            type: integer
 *            description: The headcount from the previous time window.
 *          predicted:
 *            type: integer
 *            description: The predicted headcount for the next time window.
 *     MobilityTrend:
 *       type: object
 *       properties:
 *         from:
 *           type: string
 *           format: date-time
 *           description: The start time of the measurement period.
 *         to:
 *           type: string
 *           format: date-time
 *           description: The end time of the measurement period.
 *         mobility:
 *           type: number
 *           format: float
 *           description: "Mobility score (0 to 1). 0 means no change in detected devices, 1 means all new devices."
 *
 * tags:
 *   name: Crowd Data
 *   description: Endpoints for submitting and analyzing crowd data.
 */

/**
 * @swagger
 * /crowd_data/{uniq_url}:
 *   post:
 *     summary: Submit a list of detected MAC addresses from a device
 *     tags: [Crowd Data]
 *     parameters:
 *       - in: path
 *         name: uniq_url
 *         schema:
 *           type: string
 *         required: true
 *         description: The unique URL segment identifying the device.
 *     requestBody:
 *       required: true
 *       description: A JSON array of MAC address strings.
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: string
 *             example: ["00:11:22:33:44:55", "AA:BB:CC:DD:EE:FF"]
 *     responses:
 *       200:
 *         description: Successfully processed the data. Returns current headcount, status, and neighbor predictions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *                 headcount:
 *                   type: integer
 *                 status:
 *                   type: string
 *                   enum: [safe, normal, warning, danger]
 *                 window_seconds:
 *                   type: integer
 *                 neighbors:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/NeighborPrediction'
 *       400:
 *         description: Invalid input, MAC addresses are required.
 *       404:
 *         description: Device not found for the given URL.
 *       500:
 *         description: Internal server error (e.g., threshold not set for device).
 */
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

    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()

        // 1) ensure tracked_devices entries exist (bulk insert with ON DUPLICATE KEY)
        const now = new Date()
        const macHashes = macs.map((m) => hashMac(m))

        // Prepare bulk values for insert: (mac_hash, first_seen, last_seen)
        const insertVals = []
        const insertPlaceholders = []
        for (const h of macHashes) {
            insertVals.push(h)
            insertVals.push(now)
            insertVals.push(now)
            insertPlaceholders.push('(?, ?, ?)')
        }

        if (insertVals.length > 0) {
            // Use INSERT ... ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)
            const insertSql = `INSERT INTO tracked_devices (mac_hash, first_seen, last_seen) VALUES ${insertPlaceholders.join(', ')} ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen)`
            await conn.query(insertSql, insertVals)
        }

        // 2) fetch tracked_device ids for the given mac hashes
        const trackedIds = []
        for (const h of macHashes) {
            const [rows] = await conn.query('SELECT id FROM tracked_devices WHERE mac_hash = ?', [h])
            if (rows.length > 0) trackedIds.push(rows[0].id)
        }

        // 3) insert observations for each tracked device at this device
        if (trackedIds.length > 0) {
            const obsPlaceholders = []
            const obsVals = []
            for (const tid of trackedIds) {
                obsPlaceholders.push('(?, ?, ? )')
                obsVals.push(tid)
                obsVals.push(thisDevice.id)
                obsVals.push(now)
            }
            const obsSql = `INSERT INTO device_observations (tracked_device_id, device_id, observed_at) VALUES ${obsPlaceholders.join(', ')}`
            await conn.query(obsSql, obsVals)
        }

        // 4) compute current headcount for this device (distinct tracked_device_id within window)
        const windowSeconds = 60 // current window in seconds
        const [curRows] = await conn.query(
            'SELECT COUNT(DISTINCT tracked_device_id) AS cnt FROM device_observations WHERE device_id = ? AND observed_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)'
            , [thisDevice.id, windowSeconds]
        )
        const headcount = curRows[0].cnt || 0

        // 5) determine status by threshold
        const threshold = thresholds[0]
        const status = getStatus(headcount, threshold)

        // 6) insert into crowd_data and get insertId
        const [result] = await conn.query('INSERT INTO crowd_data (device_id, headcount, status, wifi_list) VALUES (?, ?, ?, ?)', [thisDevice.id, headcount, status, JSON.stringify(macs)])
        const crowdDataId = result.insertId

        // 7) Handle alerts and webhooks
        if (status === 'warning' || status === 'danger') {
            const message = `Device ${thisDevice.device_name} (${thisDevice.location}) detected a ${status} event with headcount ${headcount}.`
            await conn.query(
                'INSERT INTO alerts (device_id, crowd_data_id, alert_type, level, message) VALUES (?, ?, ?, ?, ?)',
                [thisDevice.id, crowdDataId, 'density', status, message]
            )

            // Non-blocking webhook calls
            const [webhookRows] = await conn.query('SELECT url FROM webhooks WHERE device_id = ?', [thisDevice.id])
            if (webhookRows.length > 0) {
                const payload = {
                    deviceId: thisDevice.id,
                    deviceName: thisDevice.device_name,
                    location: thisDevice.location,
                    crowdDataId,
                    headcount,
                    status,
                    message,
                    timestamp: new Date(),
                }
                
                webhookRows.forEach(({ url }) => {
                    axios.post(url, payload)
                        .then(response => console.log(`Webhook to ${url} sent successfully.`))
                        .catch(error => console.error(`Error sending webhook to ${url}:`, error.message))
                })
            }
        }

        // 8) compute prediction for neighbors and this device using previous window
        // gather neighbors
        const [neighborsRows] = await conn.query('SELECT neighbor_device_id FROM device_neighbors WHERE device_id = ?', [thisDevice.id])
        const neighborIds = neighborsRows.map(r => r.neighbor_device_id)
        const allDeviceIds = [thisDevice.id, ...neighborIds]

        // helper to get counts for a time window
        const getCounts = async (startOffsetSec, endOffsetSec) => {
            // counts for observed_at between DATE_SUB(NOW(), INTERVAL startOffsetSec SECOND) and DATE_SUB(NOW(), INTERVAL endOffsetSec SECOND)
            const q = `SELECT device_id, COUNT(DISTINCT tracked_device_id) AS cnt FROM device_observations WHERE device_id IN (${allDeviceIds.map(()=>'?').join(',')}) AND observed_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) ${endOffsetSec>0? 'AND observed_at < DATE_SUB(NOW(), INTERVAL ? SECOND)':''} GROUP BY device_id`
            const params = [...allDeviceIds, startOffsetSec]
            if (endOffsetSec>0) params.push(endOffsetSec)
            const [r] = await conn.query(q, params)
            const map = new Map()
            for (const row of r) map.set(row.device_id, row.cnt)
            return map
        }

        const curMap = await getCounts(windowSeconds, 0)
        const prevMap = await getCounts(windowSeconds * 2, windowSeconds)

        // load device info for response
        const [deviceInfos] = await conn.query(`SELECT id, device_name, location FROM devices WHERE id IN (${allDeviceIds.map(()=>'?').join(',')})`, allDeviceIds)
        const infoMap = new Map(deviceInfos.map(d => [d.id, d]))

        const neighbors = allDeviceIds.map(id => {
            const curr = Number(curMap.get(id) || 0)
            const prev = Number(prevMap.get(id) || 0)
            const delta = curr - prev
            const predicted = clampPrediction(curr + delta)
            const info = infoMap.get(id) || { id, device_name: null, location: null }
            return {
                device_id: id,
                device_name: info.device_name,
                location: info.location,
                current: curr,
                previous: prev,
                predicted,
                // For neighbor devices, we could also compute status if thresholds exist per device; omitted for simplicity
            }
        })

        await conn.commit()

        res.json({
            device: { id: thisDevice.id, device_name: thisDevice.device_name, location: thisDevice.location },
            headcount,
            status,
            window_seconds: windowSeconds,
            neighbors,
        })
    } catch (err) {
        await conn.rollback()
        throw err
    } finally {
        conn.release()
    }

}))

/**
 * @swagger
 * /crowd_data/analysis:
 *   get:
 *     summary: Analyze mobility trends from recent crowd data
 *     tags: [Crowd Data]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: The maximum number of recent data points to analyze.
 *     responses:
 *       200:
 *         description: An analysis of mobility trends, grouped by device ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/MobilityTrend'
 *               example:
 *                 "1": [
 *                   { "from": "2023-10-27T10:00:00.000Z", "to": "2023-10-27T10:01:00.000Z", "mobility": "0.2500" }
 *                 ]
 */
router.get('/analysis', asyncHandler(async (req, res) => {
    const limit = Math.min(1000, Number(req.query.limit) || 100)
    
    const [rows] = await pool.query(
        'SELECT device_id, wifi_list, created_at FROM crowd_data WHERE wifi_list IS NOT NULL ORDER BY created_at DESC LIMIT ?',
        [limit]
    )

    const byDevice = rows.reduce((acc, row) => {
        if (!acc[row.device_id]) {
            acc[row.device_id] = []
        }
        acc[row.device_id].push(row)
        return acc
    }, {})

    const analysisResults = {}

    for (const deviceId in byDevice) {
        const deviceData = byDevice[deviceId].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const trends = []
        for (let i = 1; i < deviceData.length; i++) {
            const prev = deviceData[i-1]
            const curr = deviceData[i]

            // Ensure wifi_list is parsed correctly if it's a string
            const listA = typeof prev.wifi_list === 'string' ? JSON.parse(prev.wifi_list) : prev.wifi_list
            const listB = typeof curr.wifi_list === 'string' ? JSON.parse(curr.wifi_list) : curr.wifi_list
            
            if (listA && listB) {
                const { mobility } = analyzeMobility(listA, listB)
                trends.push({
                    from: prev.created_at,
                    to: curr.created_at,
                    mobility: mobility.toFixed(4)
                })
            }
        }
        analysisResults[deviceId] = trends
    }

    res.json(analysisResults)
}))

/**
 * @swagger
 * /crowd_data/{uniq_url}/latest:
 *   get:
 *     summary: Get the latest computed data for a specific device
 *     tags: [Crowd Data]
 *     parameters:
 *       - in: path
 *         name: uniq_url
 *         schema:
 *           type: string
 *         required: true
 *         description: The unique URL segment identifying the device.
 *     responses:
 *       200:
 *         description: The latest data including headcount, status, and neighbor predictions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *                 headcount:
 *                   type: integer
 *                 status:
 *                   type: string
 *                   enum: [safe, normal, warning, danger]
 *                 window_seconds:
 *                   type: integer
 *                 neighbors:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/NeighborPrediction'
 *       404:
 *         description: Device not found.
 *       500:
 *         description: Threshold not set for this device.
 */
router.get('/:uniq_url/latest', asyncHandler(async (req, res) => {
    const uniqUrl = req.params.uniq_url

    const [devices] = await pool.query('SELECT * FROM devices WHERE url LIKE ?', ['%' + uniqUrl])

    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }


    const thisDevice = devices[0]

    const [thresholds] = await pool.query('SELECT * FROM threshold WHERE id = ?', [thisDevice.id])

    if (thresholds.length === 0) {
        return res.status(500).json({ error: 'Threshold not set for this device' })
    }

    // read-only connection
    const conn = await pool.getConnection()
    try {
        const windowSeconds = 60

        // current counts
        const [curRows] = await conn.query(
            'SELECT COUNT(DISTINCT tracked_device_id) AS cnt FROM device_observations WHERE device_id = ? AND observed_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)'
            , [thisDevice.id, windowSeconds]
        )
        const headcount = curRows[0].cnt || 0
        const status = getStatus(headcount, thresholds[0])

        // neighbors
        const [neighborsRows] = await conn.query('SELECT neighbor_device_id FROM device_neighbors WHERE device_id = ?', [thisDevice.id])
        const neighborIds = neighborsRows.map(r => r.neighbor_device_id)
        const allDeviceIds = [thisDevice.id, ...neighborIds]

        const getCounts = async (startOffsetSec, endOffsetSec) => {
            const q = `SELECT device_id, COUNT(DISTINCT tracked_device_id) AS cnt FROM device_observations WHERE device_id IN (${allDeviceIds.map(()=>'?').join(',')}) AND observed_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) ${endOffsetSec>0? 'AND observed_at < DATE_SUB(NOW(), INTERVAL ? SECOND)':''} GROUP BY device_id`
            const params = [...allDeviceIds, startOffsetSec]
            if (endOffsetSec>0) params.push(endOffsetSec)
            const [r] = await conn.query(q, params)
            const map = new Map()
            for (const row of r) map.set(row.device_id, row.cnt)
            return map
        }

        const curMap = await getCounts(windowSeconds, 0)
        const prevMap = await getCounts(windowSeconds * 2, windowSeconds)

        const [deviceInfos] = await conn.query(`SELECT id, device_name, location FROM devices WHERE id IN (${allDeviceIds.map(()=>'?').join(',')})`, allDeviceIds)
        const infoMap = new Map(deviceInfos.map(d => [d.id, d]))

        const neighbors = allDeviceIds.map(id => {
            const curr = Number(curMap.get(id) || 0)
            const prev = Number(prevMap.get(id) || 0)
            const delta = curr - prev
            const predicted = clampPrediction(curr + delta)
            const info = infoMap.get(id) || { id, device_name: null, location: null }
            return {
                device_id: id,
                device_name: info.device_name,
                location: info.location,
                current: curr,
                previous: prev,
                predicted,
            }
        })

        res.json({
            device: { id: thisDevice.id, device_name: thisDevice.device_name, location: thisDevice.location },
            headcount,
            status,
            window_seconds: windowSeconds,
            neighbors,
        })

    } finally {
        conn.release()
    }
}))

/**
 * @swagger
 * /crowd_data/{uniq_url}/history:
 *   get:
 *     summary: Get historical crowd data for a specific device
 *     tags: [Crowd Data]
 *     parameters:
 *       - in: path
 *         name: uniq_url
 *         schema:
 *           type: string
 *         required: true
 *         description: The unique URL segment identifying the device.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: The number of recent records to return.
 *     responses:
 *       200:
 *         description: A list of historical crowd data records.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device_id:
 *                   type: integer
 *                 rows:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CrowdData'
 *       404:
 *         description: Device not found.
 */
router.get('/:uniq_url/history', asyncHandler(async (req, res) => {
    const uniqUrl = req.params.uniq_url
    const limit = Math.min(200, Number(req.query.limit) || 50)

    const [devices] = await pool.query('SELECT * FROM devices WHERE url LIKE ?', ['%' + uniqUrl])

    if (devices.length === 0) {
        return res.status(404).json({ error: 'Device not found' })
    }

    const deviceId = devices[0].id

    const [rows] = await pool.query('SELECT id, headcount, status, created_at FROM crowd_data WHERE device_id = ? ORDER BY created_at DESC LIMIT ?', [deviceId, limit])

    res.json({ device_id: deviceId, rows })
}))

module.exports = router