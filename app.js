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
// Middleware
// ──────────────────────────────────────────────
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────────
// Static Files
// ──────────────────────────────────────────────

// Serve uploaded APK files publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

// API routes
app.use('/api/version', versionRoutes);

// Admin panel redirect
app.get('/admin', (req, res) => {
    res.redirect('/admin/admin.html');
});

// ──────────────────────────────────────────────
// Health Check Endpoint (required for Koyeb)
// ──────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        mongodbState: mongoose.connection.readyState,
        // MongoDB states: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
        memory: process.memoryUsage()
    });
});

// ──────────────────────────────────────────────
// Home Route (API Info)
// ──────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        name: 'In-App Update API',
        version: '1.0.0',
        description: 'Backend for Android in-app updates with APK hosting',
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
        adminPanelUrl: `${req.protocol}://${req.get('host')}/admin`,
        uploadsUrl: `${req.protocol}://${req.get('host')}/uploads`
    });
});

// ──────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
        availableEndpoints: {
            home: '/',
            health: '/health',
            admin: '/admin',
            api: '/api/version'
        }
    });
});

// ──────────────────────────────────────────────
// Error Handler
// ──────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    console.error(err.stack);
    
    res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// ──────────────────────────────────────────────
// Connect to MongoDB and Start Server
// ──────────────────────────────────────────────
async function startServer() {
    try {
        // Ensure uploads directory exists
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('📁 Created uploads directory');
        }

        // Ensure public directory exists
        const publicDir = path.join(__dirname, 'public');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
            console.log('📁 Created public directory');
        }

        // Connect to MongoDB
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB Atlas');
        console.log('📦 Database:', mongoose.connection.db.databaseName);

        // Start server
        app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('🚀 Server is running!');
            console.log(`   ➜ Local:    http://localhost:${PORT}`);
            console.log(`   ➜ Health:   http://localhost:${PORT}/health`);
            console.log(`   ➜ Admin:    http://localhost:${PORT}/admin`);
            console.log(`   ➜ API:      http://localhost:${PORT}/api/version`);
            console.log(`   ➜ Uploads:  http://localhost:${PORT}/uploads`);
            console.log('');
        });

    } catch (err) {
        console.error('');
        console.error('❌ Failed to start server:');
        console.error('   Error:', err.message);
        console.error('');
        
        if (err.name === 'MongooseServerSelectionError') {
            console.error('💡 Tip: Check your MONGODB_URI in .env file');
            console.error('   Make sure IP address is whitelisted in MongoDB Atlas');
        }
        
        process.exit(1);
    }
}

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err.message);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM received. Shutting down...');
    try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err.message);
        process.exit(1);
    }
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
startServer();

module.exports = app;
