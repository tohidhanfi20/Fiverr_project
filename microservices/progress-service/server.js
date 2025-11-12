const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
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

// Kafka producer
const kafka = new Kafka({
  clientId: 'progress-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
producer.connect().catch(console.error);

// Kafka consumer for enrollment events
const consumer = kafka.consumer({ groupId: 'progress-service-group' });

// Start Kafka consumer
(async () => {
  await consumer.connect();
  await consumer.subscribe({ topics: ['enrollment-events'], fromBeginning: false });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        if (event.eventType === 'ENROLLMENT_COMPLETED') {
          logger.info('New enrollment detected, initializing progress', { 
            userId: event.userId, 
            courseId: event.courseId 
          });
          
          // Initialize progress tracking for new enrollment
          await pool.query(
            'INSERT INTO student_progress (user_id, course_id, enrollment_id, progress_percentage, status, last_accessed_at, created_at) VALUES ($1, $2, $3, 0, $4, NOW(), NOW()) ON CONFLICT (user_id, course_id) DO NOTHING',
            [event.userId, event.courseId, event.enrollmentId, 'in_progress']
          );
        }
      } catch (error) {
        logger.error('Error processing enrollment event', { error: error.message });
      }
    }
  });
})().catch(console.error);

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
  res.json({ status: 'healthy', service: 'progress-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Update progress
app.post('/api/progress', async (req, res) => {
  try {
    const { user_id, course_id, content_id, progress_percentage, time_spent } = req.body;

    // Update or insert progress
    const result = await pool.query(
      `INSERT INTO student_progress (user_id, course_id, content_id, progress_percentage, time_spent, last_accessed_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0), NOW(), NOW())
       ON CONFLICT (user_id, course_id) 
       DO UPDATE SET 
         content_id = EXCLUDED.content_id,
         progress_percentage = GREATEST(student_progress.progress_percentage, EXCLUDED.progress_percentage),
         time_spent = student_progress.time_spent + COALESCE(EXCLUDED.time_spent, 0),
         last_accessed_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [user_id, course_id, content_id, progress_percentage, time_spent]
    );

    const progress = result.rows[0];

    // Check if course is completed
    if (progress.progress_percentage >= 100 && progress.status !== 'completed') {
      await pool.query(
        'UPDATE student_progress SET status = $1, completed_at = NOW() WHERE user_id = $2 AND course_id = $3',
        ['completed', user_id, course_id]
      );

      // Publish completion event
      await producer.send({
        topic: 'progress-events',
        messages: [{
          key: `${user_id}-${course_id}`,
          value: JSON.stringify({
            eventType: 'COURSE_COMPLETED',
            userId: user_id,
            courseId: course_id,
            completedAt: new Date().toISOString()
          })
        }]
      });

      logger.info('Course completed', { userId: user_id, courseId: course_id });
    }

    // Publish progress update event
    await producer.send({
      topic: 'progress-events',
      messages: [{
        key: `${user_id}-${course_id}`,
        value: JSON.stringify({
          eventType: 'PROGRESS_UPDATED',
          userId: user_id,
          courseId: course_id,
          progressPercentage: progress.progress_percentage,
          timestamp: new Date().toISOString()
        })
      }]
    });

    res.status(200).json(progress);
  } catch (error) {
    logger.error('Update progress error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user progress for a course
app.get('/api/progress/user/:userId/course/:courseId', async (req, res) => {
  try {
    const { userId, courseId } = req.params;
    const result = await pool.query(
      'SELECT * FROM student_progress WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get progress error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all progress for a user
app.get('/api/progress/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT sp.*, c.title as course_title FROM student_progress sp JOIN courses c ON sp.course_id = c.id WHERE sp.user_id = $1 ORDER BY sp.last_accessed_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get user progress error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all progress for a course
app.get('/api/progress/course/:courseId', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      'SELECT sp.*, u.name as user_name, u.email FROM student_progress sp JOIN users u ON sp.user_id = u.id WHERE sp.course_id = $1 ORDER BY sp.progress_percentage DESC',
      [courseId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get course progress error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8083;
app.listen(PORT, () => {
  logger.info(`Progress service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  await consumer.disconnect();
  await pool.end();
  process.exit(0);
});

