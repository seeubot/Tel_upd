const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');
const AppVersion = require('../models/AppVersion');

// ──────────────────────────────────────────────
// Multer - store in memory, then pipe to GridFS
// No disk writes — safe for ephemeral hosts like Koyeb
// ──────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: function (req, file, cb) {
        if (path.extname(file.originalname).toLowerCase() !== '.apk') {
            return cb(new Error('Only .apk files are allowed'));
        }
        cb(null, true);
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

// ──────────────────────────────────────────────
// GridFS helper
// ──────────────────────────────────────────────
function getBucket() {
    return new GridFSBucket(mongoose.connection.db, { bucketName: 'apks' });
}

// ──────────────────────────────────────────────
// GET /api/version/check?currentVersion=1
// ──────────────────────────────────────────────
router.get('/check', async (req, res) => {
    try {
        const currentVersion = parseInt(req.query.currentVersion) || 0;

        const latestVersion = await AppVersion.findOne({
            versionCode: { $gt: currentVersion },
            isActive: true
        }).sort({ versionCode: -1 });

        if (latestVersion) {
            res.json({
                hasUpdate: true,
                versionCode: latestVersion.versionCode,
                versionName: latestVersion.versionName,
                apkUrl: latestVersion.apkUrl,
                updateMessage: latestVersion.updateMessage,
                releaseNotes: latestVersion.releaseNotes,
                fileSize: latestVersion.fileSize,
                isForceUpdate: latestVersion.isForceUpdate
            });
        } else {
            res.json({
                hasUpdate: false,
                currentVersion: currentVersion,
                message: 'You are using the latest version'
            });
        }

    } catch (error) {
        console.error('Check update error:', error);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
});

// ──────────────────────────────────────────────
// GET /api/version/latest
// ──────────────────────────────────────────────
router.get('/latest', async (req, res) => {
    try {
        const latestVersion = await AppVersion.findOne({ isActive: true })
            .sort({ versionCode: -1 });

        if (!latestVersion) {
            return res.status(404).json({ error: 'No versions available' });
        }

        res.json({
            versionCode: latestVersion.versionCode,
            versionName: latestVersion.versionName,
            apkUrl: latestVersion.apkUrl,
            updateMessage: latestVersion.updateMessage,
            releaseNotes: latestVersion.releaseNotes,
            fileSize: latestVersion.fileSize,
            isForceUpdate: latestVersion.isForceUpdate,
            createdAt: latestVersion.createdAt
        });

    } catch (error) {
        console.error('Get latest error:', error);
        res.status(500).json({ error: 'Failed to fetch latest version' });
    }
});

// ──────────────────────────────────────────────
// GET /api/version/download/:gridfsId
// Streams the APK directly from GridFS with proper
// error handling and logging to diagnose truncation
// ──────────────────────────────────────────────
router.get('/download/:gridfsId', async (req, res) => {
    try {
        let fileId;
        try {
            fileId = new ObjectId(req.params.gridfsId);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid file ID' });
        }

        const bucket = getBucket();

        // Verify file exists and get metadata
        const files = await bucket.find({ _id: fileId }).toArray();
        if (!files || files.length === 0) {
            return res.status(404).json({ error: 'APK file not found' });
        }

        const file = files[0];

        // Set headers from GridFS metadata
        res.set({
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': file.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Accept-Ranges': 'bytes'
        });

        // Stream the file directly from GridFS
        const downloadStream = bucket.openDownloadStream(fileId);
        
        let bytesSent = 0;

        downloadStream.on('data', (chunk) => {
            bytesSent += chunk.length;
        });

        downloadStream.on('error', (error) => {
            console.error('❌ Download stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download stream failed' });
            }
        });

        downloadStream.on('end', () => {
            console.log(`✅ APK sent: ${bytesSent} bytes (expected: ${file.length})`);
        });

        // Handle client disconnect
        req.on('close', () => {
            if (bytesSent < file.length) {
                console.warn(`⚠️ Client disconnected after ${bytesSent}/${file.length} bytes`);
            }
            downloadStream.destroy();
        });

        downloadStream.pipe(res);

    } catch (error) {
        console.error('❌ Download error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download APK' });
        }
    }
});

// ──────────────────────────────────────────────
// POST /api/version/upload
// ──────────────────────────────────────────────
router.post('/upload', upload.single('apk'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No APK file provided' });
        }

        const { versionCode, versionName, updateMessage, releaseNotes, isForceUpdate } = req.body;

        if (!versionCode || !versionName) {
            return res.status(400).json({ error: 'versionCode and versionName are required' });
        }

        const bucket = getBucket();
        const uniqueName = 'app-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + '.apk';

        // Upload buffer to GridFS
        const gridfsFileId = await new Promise((resolve, reject) => {
            const uploadStream = bucket.openUploadStream(uniqueName, {
                contentType: 'application/vnd.android.package-archive',
                metadata: { versionCode, versionName }
            });
            uploadStream.on('error', reject);
            uploadStream.on('finish', () => resolve(uploadStream.id));
            uploadStream.end(req.file.buffer);
        });

        // APK is served via our /download route — permanent, no disk dependency
        const apkUrl = `${req.protocol}://${req.get('host')}/api/version/download/${gridfsFileId}`;

        const existingVersion = await AppVersion.findOne({ versionCode: parseInt(versionCode) });

        if (existingVersion) {
            // Delete old APK from GridFS
            if (existingVersion.apkGridFsId) {
                await bucket.delete(new ObjectId(existingVersion.apkGridFsId))
                    .catch(err => console.error('Old GridFS file delete error:', err));
            }

            existingVersion.versionName = versionName;
            existingVersion.apkFileName = uniqueName;
            existingVersion.apkGridFsId = gridfsFileId.toString();
            existingVersion.apkUrl = apkUrl;
            existingVersion.updateMessage = updateMessage || existingVersion.updateMessage;
            existingVersion.releaseNotes = releaseNotes || '';
            existingVersion.fileSize = req.file.size;
            existingVersion.isForceUpdate = isForceUpdate === 'true' || isForceUpdate === true;
            existingVersion.isActive = true;
            await existingVersion.save();

            return res.json({
                success: true,
                message: 'Version updated successfully',
                version: existingVersion
            });
        }

        const appVersion = new AppVersion({
            versionCode: parseInt(versionCode),
            versionName: versionName,
            apkFileName: uniqueName,
            apkGridFsId: gridfsFileId.toString(),
            apkUrl: apkUrl,
            updateMessage: updateMessage || 'A new version is available!',
            releaseNotes: releaseNotes || '',
            fileSize: req.file.size,
            isForceUpdate: isForceUpdate === 'true' || isForceUpdate === true
        });

        await appVersion.save();

        res.status(201).json({
            success: true,
            message: 'New version uploaded successfully',
            version: appVersion
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload APK: ' + error.message });
    }
});

// ──────────────────────────────────────────────
// GET /api/version/all
// ──────────────────────────────────────────────
router.get('/all', async (req, res) => {
    try {
        const versions = await AppVersion.find().sort({ versionCode: -1 });
        res.json(versions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch versions' });
    }
});

// ──────────────────────────────────────────────
// DELETE /api/version/:versionCode
// ──────────────────────────────────────────────
router.delete('/:versionCode', async (req, res) => {
    try {
        const version = await AppVersion.findOne({
            versionCode: parseInt(req.params.versionCode)
        });

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }

        if (version.apkGridFsId) {
            await getBucket().delete(new ObjectId(version.apkGridFsId))
                .catch(err => console.error('GridFS delete error:', err));
        }

        await AppVersion.deleteOne({ versionCode: parseInt(req.params.versionCode) });

        res.json({ success: true, message: 'Version deleted successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to delete version' });
    }
});

// ──────────────────────────────────────────────
// PUT /api/version/:versionCode/toggle
// ──────────────────────────────────────────────
router.put('/:versionCode/toggle', async (req, res) => {
    try {
        const version = await AppVersion.findOne({
            versionCode: parseInt(req.params.versionCode)
        });

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }

        version.isActive = !version.isActive;
        await version.save();

        res.json({
            success: true,
            message: version.isActive ? 'Version activated' : 'Version deactivated',
            version: version
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle version' });
    }
});

module.exports = router;
