const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const axios = require('axios');
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
  transports: [new winston.transports.Console()]
});

// Database
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'education_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password'
});

// Kafka
const kafka = new Kafka({
  clientId: 'enrollment-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
producer.connect().catch(console.error);

// Payment service URL for gRPC (fallback to REST)
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:8083';

// Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.observe({ method: req.method, route: req.route?.path || req.path, status: res.statusCode }, duration);
    httpRequestTotal.inc({ method: req.method, route: req.route?.path || req.path, status: res.statusCode });
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'enrollment-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Create enrollment
app.post('/api/enrollments', async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    // Check if already enrolled
    const existing = await pool.query(
      'SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [user_id, course_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Already enrolled' });
    }

    // Get course price
    const courseResult = await pool.query('SELECT price FROM courses WHERE id = $1', [course_id]);
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const price = courseResult.rows[0].price;

    // Create enrollment (pending payment)
    const enrollmentResult = await pool.query(
      'INSERT INTO enrollments (user_id, course_id, status, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [user_id, course_id, 'pending']
    );

    const enrollment = enrollmentResult.rows[0];

    // Call payment service via REST (gRPC can be added later)
    try {
      const paymentResponse = await axios.post(`${PAYMENT_SERVICE_URL}/api/payments`, {
        user_id,
        course_id,
        amount: price,
        enrollment_id: enrollment.id
      });

      // Update enrollment status
      await pool.query(
        'UPDATE enrollments SET status = $1, payment_id = $2 WHERE id = $3',
        ['completed', paymentResponse.data.id, enrollment.id]
      );

      enrollment.status = 'completed';
      enrollment.payment_id = paymentResponse.data.id;

      // Publish event
      await producer.send({
        topic: 'enrollment-events',
        messages: [{
          key: enrollment.id.toString(),
          value: JSON.stringify({
            eventType: 'ENROLLMENT_COMPLETED',
            enrollmentId: enrollment.id,
            userId: user_id,
            courseId: course_id,
            timestamp: new Date().toISOString()
          })
        }]
      });

      logger.info('Enrollment completed', { enrollmentId: enrollment.id });
      res.status(201).json(enrollment);
    } catch (paymentError) {
      // Payment failed
      await pool.query('UPDATE enrollments SET status = $1 WHERE id = $2', ['failed', enrollment.id]);
      logger.error('Payment failed', { error: paymentError.message });
      res.status(402).json({ error: 'Payment failed', enrollment_id: enrollment.id });
    }
  } catch (error) {
    logger.error('Create enrollment error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user enrollments
app.get('/api/enrollments/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT e.*, c.title, c.description FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE e.user_id = $1 ORDER BY e.created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get enrollments error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get course enrollments
app.get('/api/enrollments/course/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      'SELECT e.*, u.name, u.email FROM enrollments e JOIN users u ON e.user_id = u.id WHERE e.course_id = $1 ORDER BY e.created_at DESC',
      [courseId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get course enrollments error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8082;
app.listen(PORT, () => {
  logger.info(`Enrollment service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});

