const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const versionRoutes = require('./routes/version');

const app = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
// CORS Configuration
// ──────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));

app.options('*', cors());

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
app.use(morgan('combined'));
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url} from ${req.get('origin') || 'unknown'}`);
    next();
});

// ──────────────────────────────────────────────
// Static Files
// ──────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────
app.use('/api/version', versionRoutes);

app.get('/admin', (req, res) => {
    res.redirect('/admin/admin.html');
});

// ──────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        mongodbState: mongoose.connection.readyState,
        memory: process.memoryUsage()
    });
});

// ──────────────────────────────────────────────
// Home Route
// ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        name: 'In-App Update API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            checkUpdate: 'GET /api/version/check?currentVersion=1',
            getLatest: 'GET /api/version/latest',
            getAllVersions: 'GET /api/version/all',
            uploadApk: 'POST /api/version/upload',
            deleteVersion: 'DELETE /api/version/:versionCode',
            toggleVersion: 'PUT /api/version/:versionCode/toggle',
            adminPanel: '/admin'
        },
        adminPanelUrl: `${req.protocol}://${req.get('host')}/admin`
    });
});

// ──────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
    });
});

// ──────────────────────────────────────────────
// Error Handler
// ──────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err.message);
    res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────
async function startServer() {
    try {
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('📁 Created uploads directory');
        }

        const publicDir = path.join(__dirname, 'public');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
            console.log('📁 Created public directory');
        }

        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB Atlas');
        console.log('📦 Database:', mongoose.connection.db.databaseName);

        app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('🚀 Server is running!');
            console.log(`   ➜ Health:   http://localhost:${PORT}/health`);
            console.log(`   ➜ Admin:    http://localhost:${PORT}/admin`);
            console.log(`   ➜ API:      http://localhost:${PORT}/api/version`);
            console.log('');
        });

    } catch (err) {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await mongoose.connection.close();
    process.exit(0);
});

startServer();

module.exports = app;
