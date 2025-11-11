const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const ses = new AWS.SES({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event) => {
  console.log('SQS event received:', JSON.stringify(event, null, 2));
  
  try {
    for (const record of event.Records) {
      const message = JSON.parse(record.body);
      const { userId, type, message: notificationMessage } = message;
      
      console.log(`Processing notification for user ${userId}, type: ${type}`);
      
      // Get user email (in production, fetch from user service)
      // For now, using a placeholder
      const userEmail = `user${userId}@example.com`;
      
      // Send email via SES
      try {
        await ses.sendEmail({
          Source: process.env.SES_FROM_EMAIL || 'noreply@education-platform.com',
          Destination: {
            ToAddresses: [userEmail]
          },
          Message: {
            Subject: {
              Data: 'Education Platform Notification'
            },
            Body: {
              Text: {
                Data: notificationMessage || 'You have a new notification.'
              }
            }
          }
        }).promise();
        
        console.log(`Email sent to ${userEmail}`);
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        // Continue processing even if email fails
      }
      
      // Update notification status in DynamoDB
      try {
        await dynamodb.update({
          TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'notifications',
          Key: {
            notificationId: `${Date.now()}_${Math.random()}`
          },
          UpdateExpression: 'SET #status = :status, #sentAt = :sentAt',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#sentAt': 'sentAt'
          },
          ExpressionAttributeValues: {
            ':status': 'sent',
            ':sentAt': new Date().toISOString()
          }
        }).promise();
      } catch (dbError) {
        console.error('Error updating notification status:', dbError);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Notifications processed successfully' })
    };
  } catch (error) {
    console.error('Error processing notifications:', error);
    throw error;
  }
};

