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

// DynamoDB
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

// SQS (for Lambda trigger)
const sqs = new AWS.SQS({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Kafka
const kafka = new Kafka({
  clientId: 'payment-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});

const producer = kafka.producer();
producer.connect().catch(console.error);

// Kafka consumer for notifications
const consumer = kafka.consumer({ groupId: 'payment-service-notifications-group' });

// Start Kafka consumer for notifications
(async () => {
  await consumer.connect();
  await consumer.subscribe({ topics: ['user-events', 'enrollment-events', 'payment-events'], fromBeginning: false });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        logger.info('Received event for notification', { topic, eventType: event.eventType });

        // Store notification in DynamoDB
        await dynamodb.put({
          TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'notifications-production',
          Item: {
            notificationId: `${Date.now()}_${Math.random()}`,
            userId: event.userId || event.user_id,
            type: event.eventType,
            message: generateNotificationMessage(event),
            status: 'pending',
            timestamp: new Date().toISOString()
          }
        }).promise();

        // Send to SQS for Lambda processing
        await sqs.sendMessage({
          QueueUrl: process.env.SQS_NOTIFICATION_QUEUE || 'notification-queue',
          MessageBody: JSON.stringify({
            userId: event.userId || event.user_id,
            type: event.eventType,
            message: generateNotificationMessage(event)
          })
        }).promise();
      } catch (error) {
        logger.error('Error processing notification event', { error: error.message });
      }
    }
  });
})().catch(console.error);

function generateNotificationMessage(event) {
  switch (event.eventType) {
    case 'USER_REGISTERED':
      return 'Welcome! Your account has been created successfully.';
    case 'ENROLLMENT_COMPLETED':
      return `Congratulations! You have successfully enrolled in the course.`;
    case 'PAYMENT_COMPLETED':
      return `Your payment of $${event.amount} has been processed successfully.`;
    default:
      return 'You have a new notification.';
  }
}

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
  res.json({ status: 'healthy', service: 'payment-service' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Process payment
app.post('/api/payments', async (req, res) => {
  try {
    const { user_id, course_id, amount, enrollment_id, payment_method } = req.body;

    // Simulate payment processing (in production, integrate with payment gateway)
    const paymentResult = await pool.query(
      'INSERT INTO payments (user_id, course_id, amount, status, payment_method, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
      [user_id, course_id, amount, 'completed', payment_method || 'credit_card']
    );

    const payment = paymentResult.rows[0];

    // Store payment token in DynamoDB
    const paymentToken = `token_${Date.now()}_${payment.id}`;
    await dynamodb.put({
      TableName: process.env.DYNAMODB_PAYMENT_TOKENS_TABLE || 'payment-tokens',
      Item: {
        paymentId: payment.id.toString(),
        token: paymentToken,
        userId: user_id,
        amount: amount,
        timestamp: new Date().toISOString()
      }
    }).promise();

    // Publish event to Kafka
    await producer.send({
      topic: 'payment-events',
      messages: [{
        key: payment.id.toString(),
        value: JSON.stringify({
          eventType: 'PAYMENT_COMPLETED',
          paymentId: payment.id,
          userId: user_id,
          courseId: course_id,
          amount: amount,
          timestamp: new Date().toISOString()
        })
      }]
    });

    // Send to SQS for Lambda processing (async notification)
    await sqs.sendMessage({
      QueueUrl: process.env.SQS_NOTIFICATION_QUEUE || 'notification-queue',
      MessageBody: JSON.stringify({
        type: 'PAYMENT_COMPLETED',
        paymentId: payment.id,
        userId: user_id,
        amount: amount
      })
    }).promise();

    logger.info('Payment processed', { paymentId: payment.id, amount });
    res.status(201).json(payment);
  } catch (error) {
    logger.error('Payment processing error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get payment by ID
app.get('/api/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get payment error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user payments
app.get('/api/payments/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get user payments error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notification endpoints
// Get user notifications
app.get('/api/notifications/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await dynamodb.query({
      TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'notifications-production',
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      },
      ScanIndexForward: false,
      Limit: 50
    }).promise();

    res.json(result.Items || []);
  } catch (error) {
    logger.error('Get notifications error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send notification manually
app.post('/api/notifications', async (req, res) => {
  try {
    const { userId, type, message } = req.body;

    await dynamodb.put({
      TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'notifications-production',
      Item: {
        notificationId: `${Date.now()}_${Math.random()}`,
        userId: userId,
        type: type,
        message: message,
        status: 'pending',
        timestamp: new Date().toISOString()
      }
    }).promise();

    // Send to SQS
    await sqs.sendMessage({
      QueueUrl: process.env.SQS_NOTIFICATION_QUEUE || 'notification-queue',
      MessageBody: JSON.stringify({ userId, type, message })
    }).promise();

    res.status(201).json({ success: true });
  } catch (error) {
    logger.error('Send notification error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8083;
app.listen(PORT, () => {
  logger.info(`Payment service listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await producer.disconnect();
  await consumer.disconnect();
  await pool.end();
  process.exit(0);
});

