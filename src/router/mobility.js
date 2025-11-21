const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')
const { analyzeMobility } = require('../utils/crowdHelper')

/**
 * @swagger
 * tags:
 *   name: Mobility Analysis
 *   description: Endpoints for analyzing crowd mobility between devices.
 */

/**
 * @swagger
 * /mobility/analysis:
 *   get:
 *     summary: Analyze crowd mobility between two devices based on recent data.
 *     tags: [Mobility Analysis]
 *     parameters:
 *       - in: query
 *         name: device1_id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ID of the first device.
 *       - in: query
 *         name: device2_id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ID of the second device.
 *       - in: query
 *         name: window_seconds
 *         schema:
 *           type: integer
 *           default: 120
 *         description: The time window in seconds to look for recent data for both devices.
 *     responses:
 *       200:
 *         description: Successfully analyzed the mobility between the two devices.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 from_device_id:
 *                   type: integer
 *                 to_device_id:
 *                   type: integer
 *                 analysis_window_seconds:
 *                   type: integer
 *                 from_device_data:
 *                   type: object
 *                   properties:
 *                     crowd_data_id:
 *                       type: integer
 *                     mac_count:
 *                       type: integer
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                 to_device_data:
 *                   type: object
 *                   properties:
 *                     crowd_data_id:
 *                       type: integer
 *                     mac_count:
 *                       type: integer
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                 mobility_analysis:
 *                   type: object
 *                   properties:
 *                     common_mac_count:
 *                       type: integer
 *                       description: The number of MAC addresses seen by both devices.
 *                     total_unique_mac_count:
 *                       type: integer
 *                       description: The total number of unique MAC addresses seen across both devices.
 *                     jaccard_similarity:
 *                       type: number
 *                       format: float
 *                       description: "Jaccard similarity index (intersection / union). 1 means identical crowds, 0 means no overlap."
 *                     mobility_score:
 *                       type: number
 *                       format: float
 *                       description: "Mobility score (1 - Jaccard). 1 means completely different crowds, 0 means identical."
 *       400:
 *         description: Two distinct device IDs are required.
 *       404:
 *         description: No recent crowd data found for one or both devices in the specified time window.
 */
router.get('/analysis', asyncHandler(async (req, res) => {
    const { device1_id, device2_id } = req.query
    const windowSeconds = parseInt(req.query.window_seconds, 10) || 120

    if (!device1_id || !device2_id || device1_id === device2_id) {
        return res.status(400).json({ error: '두 개의 서로 다른 장치 ID가 필요합니다.' })
    }

    // Helper function to get the latest crowd data for a device within the window
    const getLatestDeviceData = async (deviceId) => {
        const [rows] = await pool.query(
            `SELECT id, wifi_list, created_at
             FROM crowd_data
             WHERE device_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) AND JSON_VALID(wifi_list)
             ORDER BY created_at DESC
             LIMIT 1`,
            [deviceId, windowSeconds]
        )
        return rows[0]
    }

    const [data1, data2] = await Promise.all([
        getLatestDeviceData(device1_id),
        getLatestDeviceData(device2_id)
    ])

    if (!data1 || !data2) {
        return res.status(404).json({ error: `지정된 시간(${windowSeconds}초) 내에 두 장치의 최신 데이터를 찾을 수 없습니다.` })
    }

    const listA = typeof data1.wifi_list === 'string' ? JSON.parse(data1.wifi_list || '[]') : (data1.wifi_list || []);
    const listB = typeof data2.wifi_list === 'string' ? JSON.parse(data2.wifi_list || '[]') : (data2.wifi_list || []);

    const { jaccard, mobility, intersection, union } = analyzeMobility(listA, listB)

    res.json({
        from_device_id: parseInt(device1_id, 10),
        to_device_id: parseInt(device2_id, 10),
        analysis_window_seconds: windowSeconds,
        from_device_data: {
            crowd_data_id: data1.id,
            mac_count: listA.length,
            created_at: data1.created_at
        },
        to_device_data: {
            crowd_data_id: data2.id,
            mac_count: listB.length,
            created_at: data2.created_at
        },
        mobility_analysis: {
            common_mac_count: intersection.size,
            total_unique_mac_count: union.size,
            jaccard_similarity: jaccard,
            mobility_score: mobility
        }
    })
}))

module.exports = router