// server/testserver.js
// express.Router for /api/testserver/*
// Minimal, safe, returns JSON. Put any project server logic here.

const express = require('express');
const router = express.Router();

// GET /api/testserver/ping
router.get('/ping', (req, res) => {
  res.json({
    ok: true,
    msg: 'pong',
    time: new Date().toISOString(),
    port: process.env.PORT || null
  });
});

// POST /api/testserver/echo  (accepts JSON body)
router.post('/echo', express.json({ limit: '1mb' }), (req, res) => {
  res.json({
    ok: true,
    echo: req.body || null,
    time: new Date().toISOString()
  });
});

// example: GET /api/testserver/info  (simple info)
router.get('/info', (req, res) => {
  res.json({
    ok: true,
    project: 'testserver',
    description: 'Minimal testserver API for Smart Vision',
    time: new Date().toISOString()
  });
});

module.exports = router;
