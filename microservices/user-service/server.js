const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const promClient = require('prom-client');
const winston = require('winston');

const app = express();
app.use(express.json());

// Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console()
  ]
});

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'education_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password'
});

// Kafka producer
const kafka = new Kafka({
  clientId: 'user-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
producer.connect().catch(console.error);

// Middleware for metrics
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.observe({ method: req.method, route: req.route?.path || req.path, status: res.statusCode }, duration);
    httpRequestTotal.inc({ method: req.method, route: req.route?.path || req.path, status: res.statusCode });
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Register user
app.post('/api/users/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, email, name, role, created_at',
      [email, hashedPassword, name, role || 'student']
    );

    const user = result.rows[0];

    // Publish event to Kafka
    await producer.send({
      topic: 'user-events',
      messages: [{
        key: user.id.toString(),
        value: JSON.stringify({
          eventType: 'USER_REGISTERED',
          userId: user.id,
          email: user.email,
          role: user.role,
          timestamp: new Date().toISOString()
        })
      }]
    });

    logger.info('User registered', { userId: user.id, email: user.email });
    res.status(201).json(user);
  } catch (error) {
    logger.error('Registration error', { error: error.message });
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'User already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Login
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    logger.info('User logged in', { userId: user.id });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get user error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    const result = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3 RETURNING id, email, name, role, created_at',
      [name, email, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Publish event
    await producer.send({
      topic: 'user-events',
      messages: [{
        key: user.id.toString(),
        value: JSON.stringify({
          eventType: 'USER_UPDATED',
          userId: user.id,
          timestamp: new Date().toISOString()
        })
      }]
    });

    logger.info('User updated', { userId: user.id });
    res.json(user);
  } catch (error) {
    logger.error('Update user error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`User service listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});

