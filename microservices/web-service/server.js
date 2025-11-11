const express = require('express');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const promClient = require('prom-client');
const winston = require('winston');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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

// Service URLs
const USER_SERVICE = process.env.USER_SERVICE_URL || 'http://user-service:8080';
const COURSE_SERVICE = process.env.COURSE_SERVICE_URL || 'http://course-service:8081';
const ENROLLMENT_SERVICE = process.env.ENROLLMENT_SERVICE_URL || 'http://enrollment-service:8082';

// Kafka producer for learning events
const kafka = new Kafka({
  clientId: 'web-service',
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
  res.json({ status: 'healthy', service: 'web-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Proxy endpoints
app.post('/api/users/register', async (req, res) => {
  try {
    const response = await axios.post(`${USER_SERVICE}/api/users/register`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const response = await axios.post(`${USER_SERVICE}/api/users/login`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const response = await axios.get(`${COURSE_SERVICE}/api/courses`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/courses/:id', async (req, res) => {
  try {
    const response = await axios.get(`${COURSE_SERVICE}/api/courses/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post('/api/enrollments', async (req, res) => {
  try {
    const response = await axios.post(`${ENROLLMENT_SERVICE}/api/enrollments`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Track learning events
app.post('/api/events/learning', async (req, res) => {
  try {
    const { userId, courseId, eventType, metadata } = req.body;

    await producer.send({
      topic: 'learning-events',
      messages: [{
        key: userId?.toString() || 'anonymous',
        value: JSON.stringify({
          userId,
          courseId,
          eventType, // 'PAGE_VIEW', 'VIDEO_WATCH', 'QUIZ_ATTEMPT', etc.
          metadata,
          timestamp: new Date().toISOString()
        })
      }]
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Learning event error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Web service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  process.exit(0);
});

