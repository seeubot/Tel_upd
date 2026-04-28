const mongoose = require('mongoose');

const appVersionSchema = new mongoose.Schema({
    versionCode: {
        type: Number,
        required: true,
        unique: true
    },
    versionName: {
        type: String,
        required: true
    },
    apkFileName: {
        type: String,
        required: true
    },
    apkFilePath: {
        type: String,
        required: true
    },
    apkUrl: {
        type: String,
        required: true
    },
    updateMessage: {
        type: String,
        default: 'A new version is available! Please update your app.'
    },
    releaseNotes: {
        type: String,
        default: ''
    },
    fileSize: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isForceUpdate: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

appVersionSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('AppVersion', appVersionSchema);
