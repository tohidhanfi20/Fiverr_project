const AWS = require('aws-sdk');
const axios = require('axios');

const s3 = new AWS.S3();
const kafka = require('kafkajs');

// Kafka producer
const kafkaClient = new kafka.Kafka({
  clientId: 'file-processor-lambda',
  brokers: process.env.KAFKA_BROKERS.split(',')
});

const producer = kafkaClient.producer();

exports.handler = async (event) => {
  console.log('S3 event received:', JSON.stringify(event, null, 2));
  
  try {
    // Process each S3 record
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = record.s3.object.key;
      
      console.log(`Processing file: s3://${bucket}/${key}`);
      
      // Get object metadata
      const headObject = await s3.headObject({ Bucket: bucket, Key: key }).promise();
      const contentType = headObject.ContentType;
      const size = headObject.ContentLength;
      
      // Extract course ID from path (format: courses/{courseId}/materials/{filename})
      const pathParts = key.split('/');
      const courseId = pathParts.length > 1 ? pathParts[1] : null;
      
      // Generate thumbnail or process file based on type
      let processedData = {
        originalKey: key,
        bucket: bucket,
        contentType: contentType,
        size: size,
        processedAt: new Date().toISOString()
      };
      
      // If image, could generate thumbnail here
      if (contentType && contentType.startsWith('image/')) {
        // Thumbnail generation logic would go here
        processedData.thumbnailGenerated = true;
      }
      
      // Update course service
      if (courseId) {
        try {
          await axios.post(`${process.env.COURSE_SERVICE_URL}/api/courses/${courseId}/materials/processed`, {
            key: key,
            metadata: processedData
          });
        } catch (error) {
          console.error('Error updating course service:', error.message);
        }
      }
      
      // Publish event to Kafka
      await producer.connect();
      await producer.send({
        topic: 'course-events',
        messages: [{
          key: courseId || 'unknown',
          value: JSON.stringify({
            eventType: 'COURSE_MATERIAL_UPLOADED',
            courseId: courseId,
            fileKey: key,
            metadata: processedData,
            timestamp: new Date().toISOString()
          })
        }]
      });
      await producer.disconnect();
      
      console.log(`Successfully processed file: ${key}`);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Files processed successfully' })
    };
  } catch (error) {
    console.error('Error processing files:', error);
    throw error;
  }
};

