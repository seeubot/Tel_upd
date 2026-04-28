const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AppVersion = require('../models/AppVersion');

// Configure multer for APK upload
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'app-' + uniqueSuffix + '.apk');
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function(req, file, cb) {
        if (path.extname(file.originalname).toLowerCase() !== '.apk') {
            return cb(new Error('Only .apk files are allowed'));
        }
        cb(null, true);
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

// GET /api/version/check?currentVersion=1
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

// GET /api/version/latest
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

// POST /api/version/upload
router.post('/upload', upload.single('apk'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No APK file provided' });
        }

        const { versionCode, versionName, updateMessage, releaseNotes, isForceUpdate } = req.body;

        if (!versionCode || !versionName) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ error: 'versionCode and versionName are required' });
        }

        const existingVersion = await AppVersion.findOne({ versionCode: parseInt(versionCode) });

        if (existingVersion) {
            const oldFilePath = path.join(__dirname, '..', existingVersion.apkFilePath);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }

            existingVersion.versionName = versionName;
            existingVersion.apkFileName = req.file.filename;
            existingVersion.apkFilePath = req.file.path;
            existingVersion.apkUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
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
            apkFileName: req.file.filename,
            apkFilePath: req.file.path,
            apkUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`,
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
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Failed to upload APK: ' + error.message });
    }
});

// GET /api/version/all
router.get('/all', async (req, res) => {
    try {
        const versions = await AppVersion.find().sort({ versionCode: -1 });
        res.json(versions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch versions' });
    }
});

// DELETE /api/version/:versionCode
router.delete('/:versionCode', async (req, res) => {
    try {
        const version = await AppVersion.findOne({ 
            versionCode: parseInt(req.params.versionCode) 
        });

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }

        const filePath = path.join(__dirname, '..', version.apkFilePath);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await AppVersion.deleteOne({ versionCode: parseInt(req.params.versionCode) });

        res.json({ success: true, message: 'Version deleted successfully' });

    } catch (error) {
        res.status(500).json({ error: 'Failed to delete version' });
    }
});

// PUT /api/version/:versionCode/toggle
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
