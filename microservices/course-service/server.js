const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const AWS = require('aws-sdk');
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

// S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Kafka
const kafka = new Kafka({
  clientId: 'course-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
producer.connect().catch(console.error);

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
  res.json({ status: 'healthy', service: 'course-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Create course
app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, instructor_id, price, category } = req.body;
    
    const result = await pool.query(
      'INSERT INTO courses (title, description, instructor_id, price, category, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
      [title, description, instructor_id, price, category]
    );

    const course = result.rows[0];

    await producer.send({
      topic: 'course-events',
      messages: [{
        key: course.id.toString(),
        value: JSON.stringify({
          eventType: 'COURSE_CREATED',
          courseId: course.id,
          title: course.title,
          timestamp: new Date().toISOString()
        })
      }]
    });

    logger.info('Course created', { courseId: course.id });
    res.status(201).json(course);
  } catch (error) {
    logger.error('Create course error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all courses
app.get('/api/courses', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT * FROM courses WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (category) {
      query += ` AND category = $${paramCount++}`;
      params.push(category);
    }

    if (search) {
      query += ` AND (title ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get courses error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get course by ID
app.get('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get course error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload course material (returns S3 presigned URL)
app.post('/api/courses/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    const { filename, contentType } = req.body;

    const key = `courses/${id}/materials/${Date.now()}-${filename}`;
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: process.env.S3_BUCKET || 'education-platform',
      Key: key,
      ContentType: contentType,
      Expires: 3600
    });

    res.json({ uploadUrl: presignedUrl, key });
  } catch (error) {
    logger.error('Upload material error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  logger.info(`Course service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});

