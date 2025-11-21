const express = require('express')
const router = express.Router()
const asyncHandler = require('../utils/asyncHandler')
const pool = require('../utils/db')

/**
 * @swagger
 * components:
 *   schemas:
 *     Webhook:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: The unique identifier for the webhook.
 *         device_id:
 *           type: integer
 *           description: The ID of the device this webhook is for.
 *         url:
 *           type: string
 *           description: The URL to send the webhook POST request to.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: The timestamp when the webhook was registered.
 */

/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: API for managing webhook notifications.
 */

/**
 * @swagger
 * /webhooks:
 *   post:
 *     summary: Register a new webhook URL for a device
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_id
 *               - url
 *             properties:
 *               device_id:
 *                 type: integer
 *                 example: 1
 *               url:
 *                 type: string
 *                 example: "https://example.com/my-webhook-listener"
 *     responses:
 *       201:
 *         description: The newly registered webhook.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Webhook'
 *       400:
 *         description: Missing required fields.
 *       409:
 *         description: Webhook URL already exists for this device.
 */
router.post('/', asyncHandler(async (req, res) => {
    const { device_id, url } = req.body
    if (!device_id || !url) {
        return res.status(400).json({ error: 'device_id and url are required' })
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO webhooks (device_id, url) VALUES (?, ?)',
            [device_id, url]
        )
        res.status(201).json({ id: result.insertId, device_id, url })
    } catch (error) {
        // Handle potential unique constraint violation
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This webhook URL is already registered for this device.' })
        }
        throw error
    }
}))

/**
 * @swagger
 * /webhooks/{device_id}:
 *   get:
 *     summary: Get all webhooks for a specific device
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: device_id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The device ID.
 *     responses:
 *       200:
 *         description: A list of webhooks for the device.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Webhook'
 */
router.get('/:device_id', asyncHandler(async (req, res) => {
    const { device_id } = req.params
    const [rows] = await pool.query('SELECT id, url, created_at FROM webhooks WHERE device_id = ?', [device_id])
    res.json(rows)
}))

/**
 * @swagger
 * /webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The webhook ID to delete.
 *     responses:
 *       204:
 *         description: Webhook deleted successfully.
 *       404:
 *         description: Webhook not found.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params
    const [result] = await pool.query('DELETE FROM webhooks WHERE id = ?', [id])

    if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Webhook not found' })
    }

    res.status(204).send()
}))

module.exports = router
